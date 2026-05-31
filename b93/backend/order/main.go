package main

import (
	"context"
	"encoding/json"
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
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

var (
	tracer trace.Tracer
	db     *database.MockDB
)

type OrderRequest struct {
	UserID     string  `json:"userId"`
	ProductID  string  `json:"productId"`
	Quantity   int     `json:"quantity"`
	Amount     float64 `json:"amount"`
	ForceSlow  bool    `json:"forceSlow,omitempty"`
}

type OrderResponse struct {
	OrderID   string `json:"orderId"`
	Status    string `json:"status"`
	Message   string `json:"message"`
	TraceID   string `json:"traceId"`
}

func main() {
	var cleanup func()
	var err error

	tracer, cleanup, err = telemetry.InitTracer(telemetry.TracerConfig{
		ServiceName:    "order-service",
		ServiceVersion: "1.0.0",
	})
	if err != nil {
		log.Fatalf("Failed to initialize tracer: %v", err)
	}
	defer cleanup()

	db = database.NewMockDB(tracer)

	r := gin.Default()
	r.Use(middleware.TracingMiddleware(tracer))

	r.POST("/api/orders", createOrder)
	r.GET("/api/orders/:id", getOrder)
	r.GET("/health", healthCheck)

	log.Println("Order service starting on :8081")
	if err := r.Run(":8081"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func createOrder(c *gin.Context) {
	ctx := c.Request.Context()
	ctx, span := tracer.Start(ctx, "createOrder")
	defer span.End()

	span.SetAttributes(
		attribute.String("code.function", "createOrder"),
		attribute.String("code.filepath", "backend/order/main.go"),
		attribute.Int("code.lineno", 54),
	)

	var req OrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orderID := fmt.Sprintf("ORD-%d", time.Now().UnixNano())
	span.SetAttributes(attribute.String("order.id", orderID))

	inventoryResult, err := callInventoryService(ctx, req.ProductID, req.Quantity, req.ForceSlow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Inventory service failed: " + err.Error()})
		return
	}

	paymentResult, err := callPaymentService(ctx, req.UserID, req.Amount, req.ForceSlow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Payment service failed: " + err.Error()})
		return
	}

	sql := fmt.Sprintf("INSERT INTO orders (id, user_id, product_id, quantity, amount) VALUES ('%s', '%s', '%s', %d, %.2f)",
		orderID, req.UserID, req.ProductID, req.Quantity, req.Amount)
	_, err = db.Query(ctx, sql, req.ForceSlow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.ForceSlow {
		businessCtx, businessSpan := tracer.Start(ctx, "business_logic")
		businessSpan.SetAttributes(
			attribute.String("code.function", "createOrder"),
			attribute.String("code.filepath", "backend/order/main.go"),
			attribute.Int("code.lineno", 92),
		)
		time.Sleep(time.Duration(300+rand.Intn(500)) * time.Millisecond)
		businessSpan.End()
	}

	c.JSON(http.StatusOK, OrderResponse{
		OrderID: orderID,
		Status:  "success",
		Message: fmt.Sprintf("Order created successfully. Inventory: %s, Payment: %s", inventoryResult, paymentResult),
		TraceID: trace.SpanContextFromContext(ctx).TraceID().String(),
	})
}

func callInventoryService(ctx context.Context, productID string, quantity int, slow bool) (string, error) {
	ctx, span := tracer.Start(ctx, "call_inventory_service")
	defer span.End()

	span.SetAttributes(
		attribute.String("code.function", "callInventoryService"),
		attribute.String("code.filepath", "backend/order/main.go"),
		attribute.Int("code.lineno", 103),
		attribute.String("product.id", productID),
		attribute.Int("product.quantity", quantity),
	)

	_, err := db.ExternalCall(ctx, "inventory-service", "/api/inventory/reserve", slow)
	if err != nil {
		return "", err
	}

	return "reserved", nil
}

func callPaymentService(ctx context.Context, userID string, amount float64, slow bool) (string, error) {
	ctx, span := tracer.Start(ctx, "call_payment_service")
	defer span.End()

	span.SetAttributes(
		attribute.String("code.function", "callPaymentService"),
		attribute.String("code.filepath", "backend/order/main.go"),
		attribute.Int("code.lineno", 121),
		attribute.String("user.id", userID),
		attribute.Float64("payment.amount", amount),
	)

	_, err := db.ExternalCall(ctx, "payment-service", "/api/payments/process", slow)
	if err != nil {
		return "", err
	}

	return "processed", nil
}

func getOrder(c *gin.Context) {
	ctx := c.Request.Context()
	ctx, span := tracer.Start(ctx, "getOrder")
	defer span.End()

	orderID := c.Param("id")
	span.SetAttributes(attribute.String("order.id", orderID))

	sql := fmt.Sprintf("SELECT * FROM orders WHERE id = '%s'", orderID)
	result, err := db.Query(ctx, sql, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"orderId": orderID,
		"data":    result,
		"traceId": trace.SpanContextFromContext(ctx).TraceID().String(),
	})
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "order-service"})
}
