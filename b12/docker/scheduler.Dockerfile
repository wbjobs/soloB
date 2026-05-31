FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /go/bin/scheduler ./cmd/scheduler

FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /go/bin/scheduler /app/scheduler

COPY config ./config

EXPOSE 50051

ENTRYPOINT ["/app/scheduler"]
