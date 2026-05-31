use alignment_service::alignment::alignment_service_server::AlignmentServiceServer;
use alignment_service::server::AlignmentServiceImpl;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = "[::1]:50051".parse()?;
    let service = AlignmentServiceImpl::default();

    println!("Alignment Service running on {}", addr);

    Server::builder()
        .add_service(AlignmentServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
