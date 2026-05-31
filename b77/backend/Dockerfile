FROM rust:1.75-alpine AS builder

WORKDIR /app

RUN apk add --no-cache musl-dev

COPY Cargo.toml Cargo.toml

RUN mkdir src && echo "fn main() {}" > src/main.rs

RUN cargo build --release && rm -rf src

COPY src src

RUN cargo build --release

FROM alpine:3.19

WORKDIR /app

RUN apk add --no-cache ca-certificates

COPY --from=builder /app/target/release/raytracer-backend /app/raytracer-backend

EXPOSE 8080

CMD ["./raytracer-backend"]
