.PHONY: all build generate clean

all: build

generate:
	go generate ./...

build: generate
	go build -o http-tracer .

clean:
	rm -f http-tracer
	rm -f *.o
	rm -f bpf_*.go

run: build
	sudo ./http-tracer
