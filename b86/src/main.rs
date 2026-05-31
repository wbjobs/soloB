use well_log_processing::api::create_router;

#[tokio::main]
async fn main() {
    let app = create_router();
    
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await.unwrap();
    println!("Server running on http://localhost:8080");
    
    axum::serve(listener, app).await.unwrap();
}
