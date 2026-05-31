package database

import (
	"context"
	"fmt"
	"math/rand"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

type MockDB struct {
	tracer trace.Tracer
}

func NewMockDB(tracer trace.Tracer) *MockDB {
	return &MockDB{tracer: tracer}
}

func (db *MockDB) Query(ctx context.Context, sql string, slowQuery bool, networkSlow bool) (interface{}, error) {
	ctx, span := db.tracer.Start(ctx, "db.query")
	defer span.End()

	span.SetAttributes(
		attribute.String("db.statement", sql),
		attribute.String("db.system", "mysql"),
		attribute.String("code.function", "Query"),
		attribute.String("code.filepath", "backend/common/database/mock_db.go"),
		attribute.Int("code.lineno", 25),
	)

	networkTime := time.Duration(5+rand.Intn(15)) * time.Millisecond
	processTime := time.Duration(10+rand.Intn(50)) * time.Millisecond

	if slowQuery {
		processTime = time.Duration(500+rand.Intn(1000)) * time.Millisecond
	}

	if networkSlow {
		networkTime = time.Duration(800+rand.Intn(1500)) * time.Millisecond
	}

	span.SetAttributes(
		attribute.Float64("time.network_ms", float64(networkTime.Milliseconds())),
		attribute.Float64("time.process_ms", float64(processTime.Milliseconds())),
		attribute.Float64("time.queue_ms", 0),
	)

	time.Sleep(networkTime + processTime)

	result := map[string]interface{}{
		"query":       sql,
		"duration":    (networkTime + processTime).Milliseconds(),
		"network_ms":  networkTime.Milliseconds(),
		"process_ms":  processTime.Milliseconds(),
		"timestamp":   time.Now().Format(time.RFC3339),
	}

	return result, nil
}

func (db *MockDB) Exec(ctx context.Context, sql string, slowExec bool, networkSlow bool) error {
	ctx, span := db.tracer.Start(ctx, "db.exec")
	defer span.End()

	span.SetAttributes(
		attribute.String("db.statement", sql),
		attribute.String("db.system", "mysql"),
		attribute.String("code.function", "Exec"),
		attribute.String("code.filepath", "backend/common/database/mock_db.go"),
		attribute.Int("code.lineno", 63),
	)

	networkTime := time.Duration(3+rand.Intn(10)) * time.Millisecond
	processTime := time.Duration(5+rand.Intn(30)) * time.Millisecond

	if slowExec {
		processTime = time.Duration(800+rand.Intn(1500)) * time.Millisecond
	}

	if networkSlow {
		networkTime = time.Duration(600+rand.Intn(1200)) * time.Millisecond
	}

	span.SetAttributes(
		attribute.Float64("time.network_ms", float64(networkTime.Milliseconds())),
		attribute.Float64("time.process_ms", float64(processTime.Milliseconds())),
		attribute.Float64("time.queue_ms", 0),
	)

	time.Sleep(networkTime + processTime)
	return nil
}

func (db *MockDB) ExternalCall(ctx context.Context, serviceName string, endpoint string, slowCall bool, networkSlow bool) ([]byte, error) {
	ctx, span := db.tracer.Start(ctx, "external.http_call")
	defer span.End()

	span.SetAttributes(
		attribute.String("external.service", serviceName),
		attribute.String("external.endpoint", endpoint),
		attribute.String("code.function", "ExternalCall"),
		attribute.String("code.filepath", "backend/common/database/mock_db.go"),
		attribute.Int("code.lineno", 96),
	)

	networkTime := time.Duration(10+rand.Intn(30)) * time.Millisecond
	processTime := time.Duration(10+rand.Intn(50)) * time.Millisecond

	if slowCall {
		processTime = time.Duration(600+rand.Intn(1200)) * time.Millisecond
	}

	if networkSlow {
		networkTime = time.Duration(1000+rand.Intn(2000)) * time.Millisecond
	}

	span.SetAttributes(
		attribute.Float64("time.network_ms", float64(networkTime.Milliseconds())),
		attribute.Float64("time.process_ms", float64(processTime.Milliseconds())),
		attribute.Float64("time.queue_ms", 0),
	)

	time.Sleep(networkTime + processTime)

	return []byte(fmt.Sprintf(`{"status": "success", "service": "%s", "endpoint": "%s", "network_ms": %d, "process_ms": %d}`, 
		serviceName, endpoint, networkTime.Milliseconds(), processTime.Milliseconds())), nil
}
