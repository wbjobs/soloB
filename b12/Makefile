.PHONY: all build clean proto run

all: proto build

build:
	go build -o bin/scheduler ./cmd/scheduler
	go build -o bin/executor ./cmd/executor
	go build -o bin/streaming ./cmd/streaming
	go build -o bin/dtsctl ./cmd/dtsctl
	go build -o bin/apiserver ./cmd/apiserver

proto:
	protoc --go_out=. --go-grpc_out=. api/proto/*.proto

clean:
	rm -rf bin/*

docker-build:
	docker build -t dtsplatform/scheduler:latest -f docker/scheduler.Dockerfile .
	docker build -t dtsplatform/executor:latest -f docker/executor.Dockerfile .
	docker build -t dtsplatform/streaming:latest -f docker/streaming.Dockerfile .
	docker build -t dtsplatform/apiserver:latest -f docker/apiserver.Dockerfile .

run-scheduler:
	go run ./cmd/scheduler

run-executor:
	go run ./cmd/executor

run-streaming:
	go run ./cmd/streaming

run-api:
	go run ./cmd/apiserver
