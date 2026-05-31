package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"

	"trace-platform/backend/common/database"
	"trace-platform/backend/common/middleware"
	"trace-platform/backend/common/telemetry"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

var (
	tracer trace.Tracer
	db     *database.MockDB
)

type InventoryRequest struct {
	ProductID string `json:"productId"`
	Quantity  int    `json:"quantity"`
	ForceSlow bool   `json:"forceSlow,omitempty"`
}

type InventoryResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	TraceID string `json:"traceId"`
}

func main() {
	var cleanup func()
	var err error

	tracer, cleanup, err = telemetry.InitTracer(telemetry.TracerConfig{
		ServiceName:    "inventory-service",
		ServiceVersion: "1.0.0",
	})
	if err != nil {
		log.Fatalf("Failed to initialize tracer: %v", err)
	}
	defer cleanup()

	db = database.NewMockDB(tracer)

	r := gin.Default()
	r.Use(middleware.TracingMiddleware(tracer))

	r.POST("/api/inventory/reserve", reserveInventory)
	r.GET("/api/inventory/:productId", getInventory)
	r.GET("/health", healthCheck)

	log.Println("Inventory service starting on :8082")
	if err := r.Run(":8082"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func reserveInventory(c *gin.Context) {
	ctx := c.Request.Context()
	ctx, span := tracer.Start(ctx, "reserveInventory")
	defer span.End()

	span.SetAttributes(
		attribute.String("code.function", "reserveInventory"),
		attribute.String("code.filepath", "backend/inventory/main.go"),
		attribute.Int("code.lineno", 52),
	)

	var req InventoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	span.SetAttributes(
		attribute.String("product.id", req.ProductID),
		attribute.Int("product.quantity", req.Quantity),
	)

	sql := fmt.Sprintf("SELECT stock FROM inventory WHERE product_id = '%s'", req.ProductID)
	_, err := db.Query(ctx, sql, req.ForceSlow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	updateSQL := fmt.Sprintf("UPDATE inventory SET stock = stock - %d WHERE product_id = '%s'", req.Quantity, req.ProductID)
	err = db.Exec(ctx, updateSQL, req.ForceSlow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.ForceSlow {
		businessCtx, businessSpan := tracer.Start(ctx, "business_logic")
		businessSpan.SetAttributes(
			attribute.String("code.function", "reserveInventory"),
			attribute.String("code.filepath", "backend/inventory/main.go"),
			attribute.Int("code.lineno", 87),
		)
		time.Sleep(time.Duration(200+rand.Intn(400)) * time.Millisecond)
		businessSpan.End()
	}

	c.JSON(http.StatusOK, InventoryResponse{
		Status:  "success",
		Message: fmt.Sprintf("Reserved %d units for product %s", req.Quantity, req.ProductID),
		TraceID: trace.SpanContextFromContext(ctx).TraceID().String(),
	})
}

func getInventory(c *gin.Context) {
	ctx := c.Request.Context()
	ctx, span := tracer.Start(ctx, "getInventory")
	defer span.End()

	productID := c.Param("productId")
	span.SetAttributes(attribute.String("product.id", productID))

	sql := fmt.Sprintf("SELECT * FROM inventory WHERE product_id = '%s'", productID)
	result, err := db.Query(ctx, sql, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"productId": productID,
		"stock":     result,
		"traceId":   trace.SpanContextFromContext(ctx).TraceID().String(),
	})
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "inventory-service"})
}
