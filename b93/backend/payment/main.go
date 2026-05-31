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

type PaymentRequest struct {
	UserID    string  `json:"userId"`
	Amount    float64 `json:"amount"`
	ForceSlow bool    `json:"forceSlow,omitempty"`
}

type PaymentResponse struct {
	Status     string `json:"status"`
	Message    string `json:"message"`
	PaymentID  string `json:"paymentId"`
	TraceID    string `json:"traceId"`
}

func main() {
	var cleanup func()
	var err error

	tracer, cleanup, err = telemetry.InitTracer(telemetry.TracerConfig{
		ServiceName:    "payment-service",
		ServiceVersion: "1.0.0",
	})
	if err != nil {
		log.Fatalf("Failed to initialize tracer: %v", err)
	}
	defer cleanup()

	db = database.NewMockDB(tracer)

	r := gin.Default()
	r.Use(middleware.TracingMiddleware(tracer))

	r.POST("/api/payments/process", processPayment)
	r.GET("/api/payments/:id", getPayment)
	r.GET("/health", healthCheck)

	log.Println("Payment service starting on :8083")
	if err := r.Run(":8083"); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func processPayment(c *gin.Context) {
	ctx := c.Request.Context()
	ctx, span := tracer.Start(ctx, "processPayment")
	defer span.End()

	span.SetAttributes(
		attribute.String("code.function", "processPayment"),
		attribute.String("code.filepath", "backend/payment/main.go"),
		attribute.Int("code.lineno", 52),
	)

	var req PaymentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	span.SetAttributes(
		attribute.String("user.id", req.UserID),
		attribute.Float64("payment.amount", req.Amount),
	)

	paymentID := fmt.Sprintf("PAY-%d", time.Now().UnixNano())
	span.SetAttributes(attribute.String("payment.id", paymentID))

	validateSQL := fmt.Sprintf("SELECT balance FROM users WHERE user_id = '%s'", req.UserID)
	_, err := db.Query(ctx, validateSQL, req.ForceSlow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	insertSQL := fmt.Sprintf("INSERT INTO payments (id, user_id, amount, status) VALUES ('%s', '%s', %.2f, 'success')",
		paymentID, req.UserID, req.Amount)
	err = db.Exec(ctx, insertSQL, req.ForceSlow)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.ForceSlow {
		businessCtx, businessSpan := tracer.Start(ctx, "business_logic")
		businessSpan.SetAttributes(
			attribute.String("code.function", "processPayment"),
			attribute.String("code.filepath", "backend/payment/main.go"),
			attribute.Int("code.lineno", 90),
		)
		time.Sleep(time.Duration(250+rand.Intn(450)) * time.Millisecond)
		businessSpan.End()
	}

	c.JSON(http.StatusOK, PaymentResponse{
		Status:    "success",
		Message:   fmt.Sprintf("Payment of %.2f processed successfully for user %s", req.Amount, req.UserID),
		PaymentID: paymentID,
		TraceID:   trace.SpanContextFromContext(ctx).TraceID().String(),
	})
}

func getPayment(c *gin.Context) {
	ctx := c.Request.Context()
	ctx, span := tracer.Start(ctx, "getPayment")
	defer span.End()

	paymentID := c.Param("id")
	span.SetAttributes(attribute.String("payment.id", paymentID))

	sql := fmt.Sprintf("SELECT * FROM payments WHERE id = '%s'", paymentID)
	result, err := db.Query(ctx, sql, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"paymentId": paymentID,
		"data":      result,
		"traceId":   trace.SpanContextFromContext(ctx).TraceID().String(),
	})
}

func healthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "payment-service"})
}
