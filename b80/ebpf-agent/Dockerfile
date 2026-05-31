FROM golang:1.21-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y \
    clang \
    llvm \
    libbpf-dev \
    make \
    && rm -rf /var/lib/apt/lists/*

COPY go.mod ./
RUN go mod download

COPY . .

RUN go generate ./...
RUN CGO_ENABLED=0 go build -o http-tracer .

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/http-tracer .

ENTRYPOINT ["./http-tracer"]
