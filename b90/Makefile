.PHONY: all build ebpf cli web clean install

VERSION ?= 0.1.0
BUILD_DIR ?= ./build

all: build

build: ebpf cli web

ebpf:
	@echo "Building eBPF programs..."
	@cd ebpf && go generate

cli: ebpf
	@echo "Building CLI tool..."
	@cd cli && go build -o ../$(BUILD_DIR)/dbprofiler

web:
	@echo "Building Web panel..."
	@cd web/frontend && npm install && npm run build
	@cd web/backend && go build -o ../../$(BUILD_DIR)/dbprofiler-server

clean:
	@rm -rf $(BUILD_DIR)
	@cd ebpf && go clean
	@cd cli && go clean
	@cd web/backend && go clean

install:
	@cp $(BUILD_DIR)/dbprofiler /usr/local/bin/
	@cp $(BUILD_DIR)/dbprofiler-server /usr/local/bin/

run-cli:
	@sudo $(BUILD_DIR)/dbprofiler

run-server:
	@$(BUILD_DIR)/dbprofiler-server

dev-frontend:
	@cd web/frontend && npm run dev
