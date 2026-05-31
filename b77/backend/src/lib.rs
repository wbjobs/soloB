mod raytracer;

pub use raytracer::*;

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

#[wasm_bindgen]
pub struct WasmRenderer {
    renderer: Option<Renderer>,
}

#[wasm_bindgen]
impl WasmRenderer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        WasmRenderer { renderer: None }
    }

    #[wasm_bindgen]
    pub fn load_obj(&mut self, obj_content: &str) -> Result<(), JsValue> {
        let mut loader = ObjLoader::new();
        loader.parse(obj_content).map_err(|e| JsValue::from_str(&e))?;
        loader.center_and_scale(2.0);
        let mesh = loader.to_mesh();

        let params = RenderParams {
            samples: 4,
            max_depth: 5,
            light_position: Vec3::new(5.0, 5.0, 5.0),
            resolution: (512, 512),
        };

        self.renderer = Some(Renderer::new(mesh, params));
        Ok(())
    }

    #[wasm_bindgen]
    pub fn set_params(&mut self, samples: u32, max_depth: u32, light_x: f32, light_y: f32, light_z: f32, width: u32, height: u32) {
        if let Some(renderer) = &mut self.renderer {
            renderer.params.samples = samples;
            renderer.params.max_depth = max_depth;
            renderer.params.light_position = Vec3::new(light_x, light_y, light_z);
            renderer.params.resolution = (width, height);
            
            let aspect_ratio = width as f32 / height as f32;
            renderer.camera = Camera::default(aspect_ratio);
        }
    }

    #[wasm_bindgen]
    pub fn render_tile(&self, start_x: u32, start_y: u32, width: u32, height: u32) -> Vec<u8> {
        if let Some(renderer) = &self.renderer {
            renderer.render_tile(start_x, start_y, width, height)
        } else {
            vec![0; (width * height * 4) as usize]
        }
    }

    #[wasm_bindgen]
    pub fn debug_pixel(&self, x: u32, y: u32) -> JsValue {
        if let Some(renderer) = &self.renderer {
            let result = renderer.debug_pixel(x, y);
            serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
        } else {
            JsValue::NULL
        }
    }
}

impl Default for WasmRenderer {
    fn default() -> Self {
        Self::new()
    }
}
