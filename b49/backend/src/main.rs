use actix_cors::Cors;
use actix_web::{web, App, HttpServer};
use std::sync::Mutex;

mod crdt;
mod storage;
mod api;

use storage::FileStorage;

pub struct AppState {
    pub storage: Mutex<FileStorage>,
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let storage = FileStorage::new("./data").expect("Failed to initialize storage");
    let app_state = web::Data::new(AppState {
        storage: Mutex::new(storage),
    });

    println!("Starting server at http://localhost:8080");

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .wrap(
                Cors::default()
                    .allow_any_origin()
                    .allow_any_method()
                    .allow_any_header(),
            )
            .configure(api::configure)
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
