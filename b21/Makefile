.PHONY: all bpf backend frontend clean

BPF_SRC := backend/bpf/syscalls.bpf.c
BPF_OBJ := backend/bpf/syscalls.bpf.o
BACKEND_SRC := backend/main.go
BACKEND_BIN := backend/syscall-analyzer

GO := go
CLANG := clang
LLC := llc
BPFTOOL := bpftool

BPF_CFLAGS := -O2 -g -target bpf -D__TARGET_ARCH_x86_64
BPF_CFLAGS += -I/usr/include/x86_64-linux-gnu

all: bpf backend

bpf: $(BPF_OBJ)

$(BPF_OBJ): $(BPF_SRC)
	$(CLANG) $(BPF_CFLAGS) -c $< -o $@

vmlinux:
	$(BPFTOOL) btf dump file /sys/kernel/btf/vmlinux format c > backend/bpf/vmlinux.h

backend: $(BACKEND_BIN)

$(BACKEND_BIN): $(BACKEND_SRC)
	cd backend && $(GO) mod tidy && $(GO) build -o $(notdir $@) .

frontend:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

run-backend: $(BACKEND_BIN) $(BPF_OBJ)
	sudo $(BACKEND_BIN) -bpf $(BPF_OBJ)

clean:
	rm -f $(BPF_OBJ) $(BACKEND_BIN)
	rm -rf frontend/dist
