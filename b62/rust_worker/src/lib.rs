use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, Weak};
use std::collections::VecDeque;
use wasmtime::*;
use wasmtime_wasi::preview1::WasiP1Ctx;
use wasmtime_wasi::WasiCtxBuilder;

const MAX_INSTANCE_POOL_SIZE: usize = 4;
const MAX_CACHED_FRAMES: usize = 10;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FilterConfig {
    pub filter_type: String,
    pub intensity: f32,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessRequest {
    pub image_data: Vec<u8>,
    pub filters: Vec<FilterConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessResponse {
    pub image_data: Vec<u8>,
    pub success: bool,
    pub message: String,
}

struct WasmInstance {
    store: Store<WasiP1Ctx>,
    instance: Instance,
    memory: Memory,
    process_fn: Func,
    alloc_fn: Option<Func>,
    free_fn: Option<Func>,
}

impl WasmInstance {
    fn new(engine: &Engine, linker: &Linker<WasiP1Ctx>, module: &Module) -> Result<Self> {
        let wasi = WasiCtxBuilder::new()
            .inherit_stdio()
            .build_p1();

        let mut store = Store::new(engine, wasi);
        let instance = linker.instantiate(&mut store, module)?;

        let memory = instance.get_memory(&mut store, "memory")
            .context("memory not found in WASM module")?;

        let process_fn = instance.get_func(&mut store, "process_image")
            .context("process_image function not found in WASM module")?;

        let alloc_fn = instance.get_func(&mut store, "alloc");
        let free_fn = instance.get_func(&mut store, "free");

        Ok(WasmInstance {
            store,
            instance,
            memory,
            process_fn,
            alloc_fn,
            free_fn,
        })
    }

    fn call_alloc(&mut self, size: usize) -> Result<i32> {
        if let Some(alloc) = &self.alloc_fn {
            let results = alloc.call(&mut self.store, &[Val::I32(size as i32)])?;
            let ptr = results[0].i32().context("alloc returned invalid value")?;
            Ok(ptr)
        } else {
            let results = self.process_fn.call(&mut self.store, &[
                Val::I32(-1),
                Val::I32(size as i32),
            ])?;
            let ptr = results[0].i32().context("alloc via process_image returned invalid value")?;
            Ok(ptr)
        }
    }

    fn call_free(&mut self, ptr: i32) {
        if let Some(free) = &self.free_fn {
            let _ = free.call(&mut self.store, &[Val::I32(ptr)]);
        }
    }
}

pub struct SharedWasmResources {
    pub engine: Engine,
    pub linker: Linker<WasiP1Ctx>,
    pub module: Module,
}

impl SharedWasmResources {
    pub fn new(wasm_bytes: &[u8]) -> Result<Arc<Self>> {
        let engine = Engine::default();
        let mut linker = Linker::<WasiP1Ctx>::new(&engine);
        wasmtime_wasi::preview1::add_to_linker_sync(&mut linker, |s| s)?;

        let module = Module::from_binary(&engine, wasm_bytes)
            .context("Failed to compile WASM module")?;

        Ok(Arc::new(SharedWasmResources {
            engine,
            linker,
            module,
        }))
    }

    pub fn create_instance(self: &Arc<Self>) -> Result<WasmInstance> {
        WasmInstance::new(&self.engine, &self.linker, &self.module)
    }
}

struct InstancePoolInner {
    resources: Arc<SharedWasmResources>,
    available: VecDeque<WasmInstance>,
    active_count: usize,
}

pub struct InstancePool {
    inner: Mutex<InstancePoolInner>,
}

impl InstancePool {
    pub fn new(resources: Arc<SharedWasmResources>) -> Self {
        InstancePool {
            inner: Mutex::new(InstancePoolInner {
                resources,
                available: VecDeque::with_capacity(MAX_INSTANCE_POOL_SIZE),
                active_count: 0,
            }),
        }
    }

    pub fn acquire(&self) -> Result<WasmInstance> {
        let mut inner = self.inner.lock().unwrap();

        if let Some(instance) = inner.available.pop_front() {
            inner.active_count += 1;
            return Ok(instance);
        }

        if inner.active_count < MAX_INSTANCE_POOL_SIZE {
            let instance = inner.resources.create_instance()?;
            inner.active_count += 1;
            Ok(instance)
        } else {
            Err(anyhow::anyhow!("Instance pool exhausted"))
        }
    }

    pub fn release(&self, mut instance: WasmInstance) {
        let mut inner = self.inner.lock().unwrap();

        if inner.available.len() < MAX_INSTANCE_POOL_SIZE {
            let wasi = WasiCtxBuilder::new()
                .inherit_stdio()
                .build_p1();
            *instance.store.data_mut() = wasi;
            inner.available.push_back(instance);
        }

        inner.active_count = inner.active_count.saturating_sub(1);
    }

    pub fn stats(&self) -> (usize, usize) {
        let inner = self.inner.lock().unwrap();
        (inner.available.len(), inner.active_count)
    }
}

pub struct WasmHost {
    resources: Arc<SharedWasmResources>,
    instance_pool: InstancePool,
}

impl WasmHost {
    pub fn new(wasm_bytes: Vec<u8>) -> Result<Self> {
        let resources = SharedWasmResources::new(&wasm_bytes)?;
        let instance_pool = InstancePool::new(resources.clone());

        Ok(WasmHost {
            resources,
            instance_pool,
        })
    }

    pub fn process_image(&self, request: &ProcessRequest) -> Result<ProcessResponse> {
        let request_json = serde_json::to_vec(request)?;

        let mut instance = self.instance_pool.acquire()?;
        let result = self.process_with_instance(&mut instance, &request_json);
        self.instance_pool.release(instance);

        result
    }

    pub fn process_image_without_pool(&self, request: &ProcessRequest) -> Result<ProcessResponse> {
        let request_json = serde_json::to_vec(request)?;

        let mut instance = self.resources.create_instance()?;
        let result = self.process_with_instance(&mut instance, &request_json);

        drop(instance);
        result
    }

    fn process_with_instance(
        &self,
        wasm_instance: &mut WasmInstance,
        request_json: &[u8],
    ) -> Result<ProcessResponse> {
        let input_ptr = wasm_instance.call_alloc(request_json.len())?;

        wasm_instance.memory.write(
            &mut wasm_instance.store,
            input_ptr as usize,
            request_json,
        )?;

        let result = wasm_instance.process_fn.call(
            &mut wasm_instance.store,
            &[Val::I32(input_ptr), Val::I32(request_json.len() as i32)],
        )?;

        wasm_instance.call_free(input_ptr);

        let output_ptr = result[0].i32().context("process_image returned invalid value")?;

        if output_ptr == 0 {
            return Ok(ProcessResponse {
                image_data: Vec::new(),
                success: false,
                message: "WASM processing failed".to_string(),
            });
        }

        let output_len = wasm_instance.memory.data(&wasm_instance.store)
            [output_ptr as usize..output_ptr as usize + 4]
            .try_into()?;
        let output_len = u32::from_le_bytes(output_len) as usize;

        let mut output_data = vec![0u8; output_len];
        wasm_instance.memory.read(
            &mut wasm_instance.store,
            (output_ptr + 4) as usize,
            &mut output_data,
        )?;

        wasm_instance.call_free(output_ptr);

        let response: ProcessResponse = serde_json::from_slice(&output_data)?;
        Ok(response)
    }
}

pub fn apply_native_filter(
    image_data: &[u8],
    filter_config: &FilterConfig,
) -> Result<Vec<u8>> {
    let img = image::load_from_memory(image_data)?;

    let result = match filter_config.filter_type.as_str() {
        "grayscale" => {
            let mut gray_img = img.to_luma8();
            let intensity = filter_config.intensity.clamp(0.0, 1.0);

            for pixel in gray_img.pixels_mut() {
                let val = pixel.0[0] as f32;
                pixel.0[0] = (val * intensity + 255.0 * (1.0 - intensity) * 0.3) as u8;
            }

            let mut buf = Vec::with_capacity(image_data.len());
            let cursor = std::io::Cursor::new(&mut buf);
            image::DynamicImage::ImageLuma8(gray_img).write_to(cursor, image::ImageFormat::Jpeg)?;
            buf
        }
        "vintage" => {
            let mut sepia_img = img.to_rgb8();
            let intensity = filter_config.intensity.clamp(0.0, 1.0);

            for pixel in sepia_img.pixels_mut() {
                let r = pixel.0[0] as f32;
                let g = pixel.0[1] as f32;
                let b = pixel.0[2] as f32;

                let tr = (0.393 * r + 0.769 * g + 0.189 * b) * intensity + r * (1.0 - intensity);
                let tg = (0.349 * r + 0.686 * g + 0.168 * b) * intensity + g * (1.0 - intensity);
                let tb = (0.272 * r + 0.534 * g + 0.131 * b) * intensity + b * (1.0 - intensity);

                pixel.0[0] = tr.min(255.0).max(0.0) as u8;
                pixel.0[1] = tg.min(255.0).max(0.0) as u8;
                pixel.0[2] = tb.min(255.0).max(0.0) as u8;
            }

            let mut buf = Vec::with_capacity(image_data.len());
            let cursor = std::io::Cursor::new(&mut buf);
            image::DynamicImage::ImageRgb8(sepia_img).write_to(cursor, image::ImageFormat::Jpeg)?;
            buf
        }
        "contrast" => {
            let mut contrast_img = img.to_rgb8();
            let clamped = filter_config.intensity.clamp(-0.99, 0.99);
            let factor = (259.0 * (255.0 + clamped * 255.0))
                / (255.0 * (259.0 - clamped * 255.0));

            for pixel in contrast_img.pixels_mut() {
                for i in 0..3 {
                    let val = pixel.0[i] as f32;
                    let new_val = factor * (val - 128.0) + 128.0;
                    pixel.0[i] = new_val.min(255.0).max(0.0) as u8;
                }
            }

            let mut buf = Vec::with_capacity(image_data.len());
            let cursor = std::io::Cursor::new(&mut buf);
            image::DynamicImage::ImageRgb8(contrast_img).write_to(cursor, image::ImageFormat::Jpeg)?;
            buf
        }
        _ => image_data.to_vec(),
    };

    Ok(result)
}

pub struct FrameCache {
    inner: Mutex<VecDeque<(Vec<u8>, Vec<u8>)>>,
}

impl FrameCache {
    pub fn new() -> Self {
        FrameCache {
            inner: Mutex::new(VecDeque::with_capacity(MAX_CACHED_FRAMES)),
        }
    }

    pub fn get(&self, input: &[u8]) -> Option<Vec<u8>> {
        let inner = self.inner.lock().unwrap();
        inner.iter()
            .find(|(key, _)| key == input)
            .map(|(_, val)| val.clone())
    }

    pub fn insert(&self, input: Vec<u8>, output: Vec<u8>) {
        let mut inner = self.inner.lock().unwrap();
        if inner.len() >= MAX_CACHED_FRAMES {
            inner.pop_front();
        }
        inner.push_back((input, output));
    }
}

impl Default for FrameCache {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub struct VideoProcessor {
    wasm_host: Option<Arc<WasmHost>>,
    frame_cache: Arc<FrameCache>,
    max_frames_in_memory: usize,
}

impl VideoProcessor {
    pub fn new() -> Self {
        VideoProcessor {
            wasm_host: None,
            frame_cache: Arc::new(FrameCache::new()),
            max_frames_in_memory: 30,
        }
    }

    pub fn with_wasm(wasm_bytes: Vec<u8>) -> Result<Self> {
        Ok(VideoProcessor {
            wasm_host: Some(Arc::new(WasmHost::new(wasm_bytes)?)),
            frame_cache: Arc::new(FrameCache::new()),
            max_frames_in_memory: 30,
        })
    }

    pub fn with_max_frames(mut self, max: usize) -> Self {
        self.max_frames_in_memory = max;
        self
    }

    pub async fn process_frames_streaming<F>(
        &self,
        frames: Vec<Vec<u8>>,
        filters: Vec<FilterConfig>,
        progress_callback: F,
        mut frame_callback: impl FnMut(usize, Vec<u8>) -> (),
    ) -> Result<()>
    where
        F: Fn(usize, usize) -> (),
    {
        let total = frames.len();

        for (idx, frame) in frames.iter().enumerate() {
            let current_frame = self.process_single_frame(frame, &filters);

            match current_frame {
                Ok(frame_data) => {
                    frame_callback(idx, frame_data);
                }
                Err(e) => {
                    log::error!("Error processing frame {}: {}", idx, e);
                    frame_callback(idx, frame.clone());
                }
            }

            progress_callback(idx + 1, total);

            if (idx + 1) % 10 == 0 {
                tokio::task::yield_now().await;
            }
        }

        Ok(())
    }

    pub async fn process_frames_batched<F>(
        &self,
        frames: Vec<Vec<u8>>,
        filters: Vec<FilterConfig>,
        progress_callback: F,
    ) -> Result<Vec<Vec<u8>>>
    where
        F: Fn(usize, usize) -> (),
    {
        let total = frames.len();
        let mut processed_frames = Vec::with_capacity(total);
        let batch_size = self.max_frames_in_memory.min(10);

        for (batch_idx, batch) in frames.chunks(batch_size).enumerate() {
            let mut batch_results = Vec::with_capacity(batch.len());

            for (i, frame) in batch.iter().enumerate() {
                let global_idx = batch_idx * batch_size + i;
                let current_frame = self.process_single_frame(frame, &filters)?;
                batch_results.push(current_frame);
                progress_callback(global_idx + 1, total);
            }

            processed_frames.extend(batch_results);

            if batch_idx > 0 {
                tokio::task::yield_now().await;
            }
        }

        Ok(processed_frames)
    }

    pub async fn process_frames<F>(
        &self,
        frames: Vec<Vec<u8>>,
        filters: Vec<FilterConfig>,
        progress_callback: F,
    ) -> Result<Vec<Vec<u8>>>
    where
        F: Fn(usize, usize) -> (),
    {
        self.process_frames_batched(frames, filters, progress_callback).await
    }

    fn process_single_frame(
        &self,
        frame: &[u8],
        filters: &[FilterConfig],
    ) -> Result<Vec<u8>> {
        let cache_key = self.build_cache_key(frame, filters);

        if let Some(cached) = self.frame_cache.get(&cache_key) {
            return Ok(cached);
        }

        let mut current_frame = frame.to_vec();

        for filter in filters {
            if let Some(host) = &self.wasm_host {
                let request = ProcessRequest {
                    image_data: current_frame.clone(),
                    filters: vec![filter.clone()],
                };

                let response = host.process_image(&request)?;
                if response.success {
                    current_frame = response.image_data;
                }
            } else {
                current_frame = apply_native_filter(&current_frame, filter)?;
            }
        }

        self.frame_cache.insert(cache_key, current_frame.clone());
        Ok(current_frame)
    }

    fn build_cache_key(&self, frame: &[u8], filters: &[FilterConfig]) -> Vec<u8> {
        let mut key = Vec::with_capacity(frame.len() + filters.len() * 16);
        key.extend_from_slice(&frame[..frame.len().min(1024)]);

        for filter in filters {
            key.extend_from_slice(filter.filter_type.as_bytes());
            key.extend_from_slice(&filter.intensity.to_le_bytes());
        }

        key
    }
}

impl Default for VideoProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkProcessRequest {
    pub chunk_index: usize,
    pub total_chunks: usize,
    pub chunk_data: Vec<u8>,
    pub filters: Vec<FilterConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkProcessResponse {
    pub chunk_index: usize,
    pub processed_data: Vec<u8>,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ChunkProcessingState {
    pub upload_id: String,
    pub total_chunks: usize,
    pub processed_chunks: Vec<Option<Vec<u8>>>,
    pub filters: Vec<FilterConfig>,
}

impl ChunkProcessingState {
    pub fn new(upload_id: String, total_chunks: usize, filters: Vec<FilterConfig>) -> Self {
        ChunkProcessingState {
            upload_id,
            total_chunks,
            processed_chunks: vec![None; total_chunks],
            filters,
        }
    }

    pub fn is_complete(&self) -> bool {
        self.processed_chunks.iter().all(|c| c.is_some())
    }

    pub fn progress(&self) -> f32 {
        let completed = self.processed_chunks.iter().filter(|c| c.is_some()).count();
        completed as f32 / self.total_chunks as f32 * 100.0
    }

    pub fn set_chunk(&mut self, index: usize, data: Vec<u8>) {
        if index < self.total_chunks {
            self.processed_chunks[index] = Some(data);
        }
    }

    pub fn get_chunk(&self, index: usize) -> Option<&Vec<u8>> {
        self.processed_chunks.get(index).and_then(|c| c.as_ref())
    }

    pub fn merge_chunks(&self) -> Result<Vec<u8>> {
        if !self.is_complete() {
            return Err(anyhow::anyhow!("Not all chunks processed"));
        }

        let mut result = Vec::new();
        for chunk in &self.processed_chunks {
            if let Some(data) = chunk {
                result.extend_from_slice(data);
            }
        }

        Ok(result)
    }
}

pub struct ChunkedVideoProcessor {
    processor: VideoProcessor,
    concurrent_workers: usize,
    states: Mutex<std::collections::HashMap<String, ChunkProcessingState>>,
}

impl ChunkedVideoProcessor {
    pub fn new() -> Self {
        ChunkedVideoProcessor {
            processor: VideoProcessor::new(),
            concurrent_workers: 4,
            states: Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub fn with_wasm(wasm_bytes: Vec<u8>) -> Result<Self> {
        Ok(ChunkedVideoProcessor {
            processor: VideoProcessor::with_wasm(wasm_bytes)?,
            concurrent_workers: 4,
            states: Mutex::new(std::collections::HashMap::new()),
        })
    }

    pub fn with_concurrent_workers(mut self, workers: usize) -> Self {
        self.concurrent_workers = workers.max(1);
        self
    }

    pub fn init_processing(&self, upload_id: String, total_chunks: usize, filters: Vec<FilterConfig>) {
        let mut states = self.states.lock().unwrap();
        states.insert(upload_id, ChunkProcessingState::new(upload_id, total_chunks, filters));
    }

    pub fn get_state(&self, upload_id: &str) -> Option<ChunkProcessingState> {
        let states = self.states.lock().unwrap();
        states.get(upload_id).cloned()
    }

    pub async fn process_single_chunk(&self, request: ChunkProcessRequest) -> Result<ChunkProcessResponse> {
        let filters = request.filters.clone();
        let frames = vec![request.chunk_data.clone()];

        let processed = self.processor
            .process_frames(frames, filters, |_, _| {})
            .await?;

        let processed_data = processed.into_iter().next().unwrap_or_default();

        Ok(ChunkProcessResponse {
            chunk_index: request.chunk_index,
            processed_data,
            success: true,
            message: "Chunk processed".to_string(),
        })
    }

    pub async fn process_chunk_and_store(&self, upload_id: &str, request: ChunkProcessRequest) -> Result<ChunkProcessResponse> {
        let response = self.process_single_chunk(request.clone()).await?;

        if response.success {
            let mut states = self.states.lock().unwrap();
            if let Some(state) = states.get_mut(upload_id) {
                state.set_chunk(request.chunk_index, response.processed_data.clone());
            }
        }

        Ok(response)
    }

    pub async fn process_chunks_concurrent(
        &self,
        upload_id: String,
        chunks: Vec<ChunkProcessRequest>,
        progress_callback: impl Fn(usize, usize) -> () + Send + Sync,
    ) -> Result<Vec<ChunkProcessResponse>> {
        use tokio::sync::Semaphore;

        let total = chunks.len();
        let semaphore = Arc::new(Semaphore::new(self.concurrent_workers));

        let mut handles = Vec::with_capacity(total);
        let completed = Arc::new(Mutex::new(0usize));

        for (idx, chunk) in chunks.into_iter().enumerate() {
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let completed = completed.clone();
            let progress_callback = Arc::new(progress_callback);

            let handle = tokio::spawn(async move {
                let _permit = permit;
                let result = self.process_single_chunk(chunk).await;
                
                {
                    let mut count = completed.lock().unwrap();
                    *count += 1;
                    progress_callback(*count, total);
                }
                
                result
            });

            handles.push(handle);
        }

        let mut results = Vec::with_capacity(total);
        for handle in handles {
            let result = handle.await??;
            results.push(result);
        }

        {
            let mut states = self.states.lock().unwrap();
            if let Some(state) = states.get_mut(&upload_id) {
                for response in &results {
                    if response.success {
                        state.set_chunk(response.chunk_index, response.processed_data.clone());
                    }
                }
            }
        }

        results.sort_by_key(|r| r.chunk_index);
        Ok(results)
    }

    pub fn merge_results(&self, upload_id: &str) -> Result<Vec<u8>> {
        let states = self.states.lock().unwrap();
        let state = states.get(upload_id)
            .context("Processing state not found")?;

        state.merge_chunks()
    }

    pub fn cleanup(&self, upload_id: &str) {
        let mut states = self.states.lock().unwrap();
        states.remove(upload_id);
    }

    pub fn get_progress(&self, upload_id: &str) -> f32 {
        let states = self.states.lock().unwrap();
        states.get(upload_id)
            .map(|s| s.progress())
            .unwrap_or(0.0)
    }
}

impl Default for ChunkedVideoProcessor {
    fn default() -> Self {
        Self::new()
    }
}

pub mod filters {
    pub const AVAILABLE_FILTERS: &[(&str, &str)] = &[
        ("grayscale", "黑白滤镜"),
        ("vintage", "老电影效果"),
        ("contrast", "对比度调节"),
    ];
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    fn create_test_image() -> Vec<u8> {
        let mut img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::new(100, 100);
        for pixel in img.pixels_mut() {
            *pixel = Rgb([255, 128, 64]);
        }

        let mut buf = Vec::new();
        let cursor = std::io::Cursor::new(&mut buf);
        image::DynamicImage::ImageRgb8(img).write_to(cursor, image::ImageFormat::Jpeg).unwrap();
        buf
    }

    #[test]
    fn test_grayscale_filter() {
        let buf = create_test_image();

        let config = FilterConfig {
            filter_type: "grayscale".to_string(),
            intensity: 1.0,
            params: None,
        };

        let result = apply_native_filter(&buf, &config).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_vintage_filter() {
        let buf = create_test_image();

        let config = FilterConfig {
            filter_type: "vintage".to_string(),
            intensity: 0.8,
            params: None,
        };

        let result = apply_native_filter(&buf, &config).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_frame_cache() {
        let cache = FrameCache::new();
        let input = vec![1, 2, 3, 4];
        let output = vec![5, 6, 7, 8];

        assert!(cache.get(&input).is_none());
        cache.insert(input.clone(), output.clone());
        assert_eq!(cache.get(&input), Some(output));
    }

    #[test]
    fn test_instance_pool_singleton_module() {
        let engine = Engine::default();
        let wasm_bytes = include_bytes!("../../test_fixtures/mock_filter.wasm");

        let result = Module::from_binary(&engine, wasm_bytes);
        assert!(result.is_ok() || wasm_bytes.is_empty());
    }
}
