package main

import (
	"distributed-tracing/agent"
	"fmt"
	"net/http"
	"net/http/httptest"
	"time"
)

func main() {
	agentConfig := agent.Config{
		CollectorURL: "http://localhost:8080",
		LocalFile:    "traces.json",
		UseFile:      true,
	}

	a := agent.NewAgent(agentConfig)

	fmt.Println("Generating demo traces...")

	for i := 0; i < 10; i++ {
		generateDemoTrace(a, i)
		time.Sleep(100 * time.Millisecond)
	}

	fmt.Println("Demo traces generated.")
}

func generateDemoTrace(a *agent.Agent, traceNum int) {
	ctx := agent.NewTraceContext()

	rootStart := time.Now()

	req1 := httptest.NewRequest("GET", "/api/users", nil)
	req1.Header.Set(agent.TraceparentHeader, ctx.ToHeader())

	extractedCtx := extractContext(req1)
	if extractedCtx != nil {
		fmt.Printf("Extracted traceparent: %s\n", extractedCtx.ToHeader())
	}

	time.Sleep(50 * time.Millisecond)

	child1Start := time.Now()
	child1Ctx := ctx.NewChildSpan()

	time.Sleep(10 * time.Millisecond)

	child2Start := time.Now()
	child2Ctx := child1Ctx.NewChildSpan()
	time.Sleep(20 * time.Millisecond)
	child2End := time.Now()
	child2Duration := child2End.Sub(child2Start).Microseconds()

	child2Span := &agent.Span{
		TraceID:      child2Ctx.TraceID,
		SpanID:       child2Ctx.SpanID,
		ParentSpanID: child1Ctx.SpanID,
		Name:         fmt.Sprintf("db-query-%d", traceNum),
		ServiceName:  "database",
		StartTime:    child2Start,
		EndTime:      child2End,
		Duration:     child2Duration,
		Tags: map[string]interface{}{
			"db.query":    "SELECT * FROM users WHERE id = ?",
			"db.duration": child2Duration,
		},
	}

	if err := a.SendSpan(child2Span); err != nil {
		fmt.Printf("Send child2 span error: %v\n", err)
	}

	time.Sleep(10 * time.Millisecond)

	child1End := time.Now()
	child1Duration := child1End.Sub(child1Start).Microseconds()

	child1Span := &agent.Span{
		TraceID:      child1Ctx.TraceID,
		SpanID:       child1Ctx.SpanID,
		ParentSpanID: ctx.SpanID,
		Name:         fmt.Sprintf("get-user-%d", traceNum),
		ServiceName:  "user-service",
		StartTime:    child1Start,
		EndTime:      child1End,
		Duration:     child1Duration,
		Tags: map[string]interface{}{
			"http.method": "GET",
			"http.url":    "/api/users",
			"userId":      traceNum,
		},
	}

	if err := a.SendSpan(child1Span); err != nil {
		fmt.Printf("Send child1 span error: %v\n", err)
	}

	rootEnd := time.Now()
	rootDuration := rootEnd.Sub(rootStart).Microseconds()

	rootSpan := &agent.Span{
		TraceID:      ctx.TraceID,
		SpanID:       ctx.SpanID,
		Name:         fmt.Sprintf("request-%d", traceNum),
		ServiceName:  "gateway",
		StartTime:    rootStart,
		EndTime:      rootEnd,
		Duration:     rootDuration,
		Tags: map[string]interface{}{
			"http.method": "GET",
			"http.url":    fmt.Sprintf("/demo/%d", traceNum),
		},
	}

	if err := a.SendSpan(rootSpan); err != nil {
		fmt.Printf("Send root span error: %v\n", err)
	}

	fmt.Printf("Trace %d generated: %s\n", traceNum, ctx.TraceID)
}

func extractContext(req *http.Request) *agent.TraceContext {
	header := req.Header.Get(agent.TraceparentHeader)
	if header == "" {
		return nil
	}

	ctx := &agent.TraceContext{}
	if err := ctx.FromHeader(header); err != nil {
		fmt.Printf("Parse traceparent error: %v\n", err)
		return nil
	}
	return ctx
}
