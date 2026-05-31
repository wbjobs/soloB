FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /go/bin/apiserver ./cmd/apiserver
RUN CGO_ENABLED=0 GOOS=linux go build -o /go/bin/dtsctl ./cmd/dtsctl

FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /go/bin/apiserver /app/apiserver
COPY --from=builder /go/bin/dtsctl /usr/local/bin/dtsctl

COPY config ./config

EXPOSE 8080 50051

ENTRYPOINT ["/app/apiserver"]
