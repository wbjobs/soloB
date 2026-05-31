FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /go/bin/executor ./cmd/executor

FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata python3 docker-cli

WORKDIR /app

COPY --from=builder /go/bin/executor /app/executor

COPY config ./config

ENTRYPOINT ["/app/executor"]
