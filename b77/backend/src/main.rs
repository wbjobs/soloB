mod raytracer;

use actix_web::{web, App, Error, HttpResponse, HttpServer};
use actix_web_actors::ws;
use actix_cors::Cors;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use actix::prelude::*;
use std::time::{Duration, Instant};

use raytracer::*;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Serialize, Deserialize)]
struct RenderRequest {
    obj_data: String,
    params: RenderParamsData,
}

#[derive(Debug, Serialize, Deserialize)]
struct ResolutionData {
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct RenderParamsData {
    samples: u32,
    max_depth: u32,
    light_position: Vec3Data,
    resolution: ResolutionData,
    adaptive_sampling: bool,
    edge_threshold: f32,
    max_samples: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Vec3Data {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TileResultMessage {
    r#type: String,
    task_id: String,
    tile_x: u32,
    tile_y: u32,
    tile_width: u32,
    tile_height: u32,
    pixels: Vec<u8>,
    samples_completed: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStatusMessage {
    r#type: String,
    task_id: String,
    status: String,
    progress: f32,
    total_tiles: u32,
    completed_tiles: u32,
    render_time_ms: Option<u64>,
    adaptive_sampling: bool,
    total_samples: u64,
    samples_saved: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DebugPixelRequest {
    task_id: String,
    x: u32,
    y: u32,
}

struct RenderWebSocket {
    task_id: Option<String>,
    hb: Instant,
}

impl Actor for RenderWebSocket {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.hb(ctx);
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for RenderWebSocket {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Ping(msg)) => {
                self.hb = Instant::now();
                ctx.pong(&msg);
            }
            Ok(ws::Message::Pong(_)) => {
                self.hb = Instant::now();
            }
            Ok(ws::Message::Text(text)) => {
                self.hb = Instant::now();
                if let Ok(request) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(msg_type) = request.get("type").and_then(|v| v.as_str()) {
                        match msg_type {
                            "render_request" => {
                                self.handle_render_request(request, ctx);
                            }
                            "debug_pixel" => {
                                self.handle_debug_pixel(request, ctx);
                            }
                            _ => {}
                        }
                    }
                }
            }
            Ok(ws::Message::Binary(bin)) => {
                self.hb = Instant::now();
                ctx.binary(bin);
            }
            Ok(ws::Message::Close(reason)) => {
                ctx.close(reason);
                ctx.stop();
            }
            _ => ctx.stop(),
        }
    }
}

impl RenderWebSocket {
    fn new() -> Self {
        RenderWebSocket {
            task_id: None,
            hb: Instant::now(),
        }
    }

    fn hb(&self, ctx: &mut ws::WebsocketContext<Self>) {
        ctx.run_interval(HEARTBEAT_INTERVAL, |act, ctx| {
            if Instant::now().duration_since(act.hb) > CLIENT_TIMEOUT {
                println!("WebSocket client timeout, disconnecting");
                ctx.stop();
                return;
            }
            ctx.ping(b"");
        });
    }

    fn handle_render_request(&mut self, request: serde_json::Value, ctx: &mut ws::WebsocketContext<Self>) {
        if let Some(obj_data) = request.get("obj_data").and_then(|v| v.as_str()) {
            if let Some(params) = request.get("params") {
                if let Ok(render_params) = serde_json::from_value::<RenderParamsData>(params.clone()) {
                    let task_id = Uuid::new_v4().to_string();
                    self.task_id = Some(task_id.clone());

                    let mut loader = ObjLoader::new();
                    if loader.parse(obj_data).is_ok() {
                        loader.center_and_scale(2.0);
                        let mesh = loader.to_mesh();

                        let params = RenderParams {
                            samples: render_params.samples,
                            max_depth: render_params.max_depth,
                            light_position: Vec3::new(
                                render_params.light_position.x,
                                render_params.light_position.y,
                                render_params.light_position.z,
                            ),
                            resolution: render_params.resolution,
                        };

                        let renderer = Renderer::new(mesh, params);
                        self.start_rendering(task_id, renderer, ctx);
                    }
                }
            }
        }
    }

    fn handle_debug_pixel(&mut self, request: serde_json::Value, ctx: &mut ws::WebsocketContext<Self>) {
        if let (Some(x), Some(y)) = (
            request.get("x").and_then(|v| v.as_u64()),
            request.get("y").and_then(|v| v.as_u64()),
        ) {
            if let Some(task_id) = &self.task_id {
                let response = serde_json::json!({
                    "type": "debug_pixel_result",
                    "task_id": task_id,
                    "x": x,
                    "y": y,
                    "ray_tree": [],
                    "intersections": [],
                    "shading_values": []
                });
                ctx.text(serde_json::to_string(&response).unwrap());
            }
        }
    }

    fn start_rendering(&mut self, task_id: String, renderer: Renderer, ctx: &mut ws::WebsocketContext<Self>) {
        use std::time::Instant;

        const TILE_SIZE: u32 = 16;
        let (width, height) = renderer.params.resolution;
        let adaptive_sampling = renderer.params.adaptive_sampling;

        let tiles_x = (width + TILE_SIZE - 1) / TILE_SIZE;
        let tiles_y = (height + TILE_SIZE - 1) / TILE_SIZE;
        let total_tiles = tiles_x * tiles_y;

        let status_message = TaskStatusMessage {
            r#type: "task_status".to_string(),
            task_id: task_id.clone(),
            status: "rendering".to_string(),
            progress: 0.0,
            total_tiles,
            completed_tiles: 0,
            render_time_ms: None,
            adaptive_sampling,
            total_samples: 0,
            samples_saved: None,
        };

        ctx.text(serde_json::to_string(&status_message).unwrap());

        let start_time = Instant::now();
        let mut completed_tiles = 0;
        let mut total_samples = 0u64;

        for tile_y in 0..tiles_y {
            for tile_x in 0..tiles_x {
                let start_x = tile_x * TILE_SIZE;
                let start_y = tile_y * TILE_SIZE;
                let tile_w = std::cmp::min(TILE_SIZE, width - start_x);
                let tile_h = std::cmp::min(TILE_SIZE, height - start_y);

                let (pixels, samples) = renderer.render_tile(start_x, start_y, tile_w, tile_h);
                total_samples += samples;

                let tile_result = TileResultMessage {
                    r#type: "tile_result".to_string(),
                    task_id: task_id.clone(),
                    tile_x,
                    tile_y,
                    tile_width: tile_w,
                    tile_height: tile_h,
                    pixels,
                    samples_completed: samples,
                };

                ctx.text(serde_json::to_string(&tile_result).unwrap());

                completed_tiles += 1;
                let progress = completed_tiles as f32 / total_tiles as f32;

                let status_update = TaskStatusMessage {
                    r#type: "task_status".to_string(),
                    task_id: task_id.clone(),
                    status: "rendering".to_string(),
                    progress,
                    total_tiles,
                    completed_tiles,
                    render_time_ms: None,
                    adaptive_sampling,
                    total_samples,
                    samples_saved: None,
                };

                ctx.text(serde_json::to_string(&status_update).unwrap());
            }
        }

        let render_time_ms = start_time.elapsed().as_millis() as u64;
        let total_pixels = (width * height) as u64;
        let uniform_samples = total_pixels * renderer.params.max_samples as u64;
        let samples_saved = if adaptive_sampling {
            uniform_samples.saturating_sub(total_samples)
        } else {
            0
        };

        let final_status = TaskStatusMessage {
            r#type: "task_status".to_string(),
            task_id,
            status: "completed".to_string(),
            progress: 1.0,
            total_tiles,
            completed_tiles,
            render_time_ms: Some(render_time_ms),
            adaptive_sampling,
            total_samples,
            samples_saved: if adaptive_sampling { Some(samples_saved) } else { None },
        };

        ctx.text(serde_json::to_string(&final_status).unwrap());
    }
}

async fn ws_index(r: actix_web::HttpRequest, stream: web::Payload) -> Result<HttpResponse, Error> {
    let resp = ws::start(RenderWebSocket::new(), &r, stream)?;
    Ok(resp)
}

async fn health_check() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok" }))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    std::env::set_var("RUST_LOG", "info");
    env_logger::init();

    let host = "127.0.0.1";
    let port = 8080;

    println!("Starting server at http://{}:{}/", host, port);

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header();

        App::new()
            .wrap(cors)
            .route("/ws", web::get().to(ws_index))
            .route("/health", web::get().to(health_check))
    })
    .bind((host, port))?
    .run()
    .await
}
