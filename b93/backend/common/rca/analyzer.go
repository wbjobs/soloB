package rca

import (
	"fmt"
	"math"
	"time"
)

type TimeBreakdown struct {
	NetworkTime   time.Duration `json:"networkTime"`   // 网络传输时间
	QueueTime     time.Duration `json:"queueTime"`     // 排队/等待时间
	ProcessTime   time.Duration `json:"processTime"`   // 实际处理时间
	OverheadTime  time.Duration `json:"overheadTime"`  // 其他开销
}

type Span struct {
	TraceID     string                 `json:"traceId"`
	SpanID      string                 `json:"spanId"`
	ParentID    string                 `json:"parentId,omitempty"`
	ServiceName string                 `json:"serviceName"`
	Operation   string                 `json:"operation"`
	StartTime   time.Time              `json:"startTime"`
	EndTime     time.Time              `json:"endTime"`
	Duration    time.Duration          `json:"duration"`
	Attributes  map[string]interface{} `json:"attributes"`
	Status      string                 `json:"status"`
	TimeBreakdown *TimeBreakdown       `json:"timeBreakdown,omitempty"`
}

type NetworkDiagnostic struct {
	NetworkDelayRatio float64 `json:"networkDelayRatio"`
	IsNetworkProblem  bool    `json:"isNetworkProblem"`
	NetworkSeverity   string  `json:"networkSeverity"`
}

type TimingAlignment struct {
	ClientSendTime   time.Time `json:"clientSendTime"`
	ServerRecvTime   time.Time `json:"serverRecvTime"`
	ServerSendTime   time.Time `json:"serverSendTime"`
	ClientRecvTime   time.Time `json:"clientRecvTime"`
	NetworkLatency   time.Duration `json:"networkLatency"`
	ServerProcessTime time.Duration `json:"serverProcessTime"`
}

type Trace struct {
	TraceID string `json:"traceId"`
	Spans   []Span `json:"spans"`
}

type RootCause struct {
	SpanID          string            `json:"spanId"`
	ServiceName     string            `json:"serviceName"`
	Operation       string            `json:"operation"`
	Duration        time.Duration     `json:"duration"`
	Severity        string            `json:"severity"`
	IssueType       string            `json:"issueType"`
	Analysis        string            `json:"analysis"`
	Suggestion      string            `json:"suggestion"`
	CodeLocation    string            `json:"codeLocation,omitempty"`
	SQLStatement    string            `json:"sqlStatement,omitempty"`
	TimeBreakdown   *TimeBreakdown    `json:"timeBreakdown,omitempty"`
	NetworkDiagnostic *NetworkDiagnostic `json:"networkDiagnostic,omitempty"`
	Confidence      float64           `json:"confidence"`
}

type AnalysisResult struct {
	TraceID      string      `json:"traceId"`
	TotalTime    time.Duration `json:"totalTime"`
	IsSlow       bool        `json:"isSlow"`
	RootCauses   []RootCause `json:"rootCauses"`
	Topology     []Node      `json:"topology"`
}

type Node struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Service  string   `json:"service"`
	Duration int64    `json:"duration"`
	Children []string `json:"children,omitempty"`
}

const (
	SlowThreshold       = 500 * time.Millisecond
	CriticalThreshold   = 1000 * time.Millisecond
	NetworkRatioThreshold = 0.6    // 网络时间占比超过60%视为网络问题
	NetworkTimeMin     = 100 * time.Millisecond
	HighConfidence     = 0.9
	MediumConfidence   = 0.7
	LowConfidence      = 0.5
)

func AnalyzeTrace(trace Trace) AnalysisResult {
	result := AnalysisResult{
		TraceID: trace.TraceID,
	}

	if len(trace.Spans) == 0 {
		return result
	}

	var minStart, maxEnd time.Time
	for _, span := range trace.Spans {
		if minStart.IsZero() || span.StartTime.Before(minStart) {
			minStart = span.StartTime
		}
		if span.EndTime.After(maxEnd) {
			maxEnd = span.EndTime
		}
	}
	result.TotalTime = maxEnd.Sub(minStart)
	result.IsSlow = result.TotalTime > SlowThreshold

	if result.IsSlow {
		result.RootCauses = findRootCauses(trace.Spans)
	}

	result.Topology = buildTopology(trace.Spans)

	return result
}

func findRootCauses(spans []Span) []RootCause {
	var causes []RootCause

	for i := range spans {
		span := spans[i]
		if span.Duration > SlowThreshold {
			parents := FindParentSpans(spans, span)
			cause := analyzeSlowSpan(span, parents, spans)
			causes = append(causes, cause)
		}
	}

	return causes
}

func analyzeSlowSpan(span Span, parents []Span, allSpans []Span) RootCause {
	cause := RootCause{
		SpanID:      span.SpanID,
		ServiceName: span.ServiceName,
		Operation:   span.Operation,
		Duration:    span.Duration,
	}

	breakdown := ExtractTimeBreakdown(span)
	cause.TimeBreakdown = &breakdown

	networkDiagnostic := DiagnoseNetworkIssue(span, parents)
	cause.NetworkDiagnostic = networkDiagnostic

	if span.Duration > CriticalThreshold {
		cause.Severity = "CRITICAL"
	} else {
		cause.Severity = "WARNING"
	}

	if networkDiagnostic.IsNetworkProblem {
		cause.IssueType = "NETWORK_DELAY"
		cause.Analysis = formatNetworkAnalysis(span, networkDiagnostic, &breakdown)
		cause.Suggestion = "1. 检查网络连接质量和带宽\n2. 排查是否存在网络抖动或丢包\n3. 考虑使用就近部署或CDN\n4. 检查防火墙和负载均衡配置"
		cause.Confidence = CalculateConfidence(span, networkDiagnostic, "NETWORK_DELAY")
		return cause
	}

	if sql, ok := span.Attributes["db.statement"].(string); ok {
		networkRatio := 0.0
		if span.Duration > 0 {
			networkRatio = float64(breakdown.NetworkTime) / float64(span.Duration)
		}

		if networkRatio > NetworkRatioThreshold {
			cause.IssueType = "NETWORK_DELAY"
			cause.Analysis = fmt.Sprintf("检测到网络延迟占比过高(%.1f%%)，虽然是数据库操作，但主要瓶颈在网络层", networkRatio*100)
			cause.Suggestion = "1. 检查数据库网络连接和端口配置\n2. 排查数据库连接池是否耗尽\n3. 考虑数据库与服务就近部署\n4. 检查网络带宽是否充足"
			cause.Confidence = CalculateConfidence(span, networkDiagnostic, "NETWORK_DELAY")
			return cause
		}

		cause.IssueType = "SLOW_SQL"
		cause.SQLStatement = sql
		cause.Analysis = formatSQLAnalysis(span, &breakdown)
		cause.Suggestion = "1. 检查SQL执行计划，确认是否命中索引\n2. 考虑添加适当的索引优化\n3. 评估是否需要分页查询或缓存机制\n4. 检查表锁和死锁情况"
		if filepath, ok := span.Attributes["code.filepath"].(string); ok {
			if lineno, ok := span.Attributes["code.lineno"].(int); ok {
				cause.CodeLocation = formatCodeLocation(filepath, lineno)
			}
		}
		cause.Confidence = CalculateConfidence(span, networkDiagnostic, "SLOW_SQL")
		return cause
	}

	if extService, ok := span.Attributes["external.service"].(string); ok {
		networkRatio := 0.0
		if span.Duration > 0 {
			networkRatio = float64(breakdown.NetworkTime) / float64(span.Duration)
		}

		if networkRatio > 0.5 {
			cause.IssueType = "NETWORK_DELAY"
			cause.Analysis = fmt.Sprintf("调用%s服务时网络延迟占比过高(%.1f%%)，建议排查网络链路", extService, networkRatio*100)
		} else {
			cause.IssueType = "SLOW_EXTERNAL_CALL"
			cause.Analysis = fmt.Sprintf("%s服务处理耗时过长，网络延迟占比%.1f%%", extService, networkRatio*100)
		}
		cause.Suggestion = "1. 检查" + extService + "服务的健康状态\n2. 考虑增加超时设置和重试机制\n3. 评估是否需要引入熔断降级\n4. 排查服务间网络连接质量"
		if filepath, ok := span.Attributes["code.filepath"].(string); ok {
			if lineno, ok := span.Attributes["code.lineno"].(int); ok {
				cause.CodeLocation = formatCodeLocation(filepath, lineno)
			}
		}
		cause.Confidence = CalculateConfidence(span, networkDiagnostic, "SLOW_EXTERNAL_CALL")
		return cause
	}

	if span.Operation == "business_logic" {
		cause.IssueType = "SLOW_BUSINESS_LOGIC"
		cause.Analysis = formatBusinessLogicAnalysis(span, &breakdown)
		cause.Suggestion = "1. 分析业务代码，识别性能瓶颈\n2. 考虑异步处理非核心逻辑\n3. 优化算法或数据结构\n4. 检查是否有阻塞的IO操作"
		if filepath, ok := span.Attributes["code.filepath"].(string); ok {
			if lineno, ok := span.Attributes["code.lineno"].(int); ok {
				cause.CodeLocation = formatCodeLocation(filepath, lineno)
			}
		}
		cause.Confidence = CalculateConfidence(span, networkDiagnostic, "SLOW_BUSINESS_LOGIC")
		return cause
	}

	cause.IssueType = "SLOW_OPERATION"
	cause.Analysis = "操作响应时间超出阈值"
	cause.Suggestion = "1. 详细分析该操作的子Span\n2. 检查系统资源使用情况\n3. 考虑水平扩展服务实例"
	cause.Confidence = LowConfidence

	return cause
}

func formatNetworkAnalysis(span Span, diagnostic *NetworkDiagnostic, breakdown *TimeBreakdown) string {
	ratio := diagnostic.NetworkDelayRatio * 100
	return fmt.Sprintf(
		"网络延迟导致超时（置信度: %.0f%%）- 总耗时 %v，网络延迟占比 %.1f%%（网络时间: %v, 处理时间: %v）",
		CalculateConfidence(span, diagnostic, "NETWORK_DELAY")*100,
		span.Duration,
		ratio,
		breakdown.NetworkTime,
		breakdown.ProcessTime,
	)
}

func formatSQLAnalysis(span Span, breakdown *TimeBreakdown) string {
	processRatio := float64(0)
	if span.Duration > 0 {
		processRatio = float64(breakdown.ProcessTime) / float64(span.Duration) * 100
	}
	return fmt.Sprintf(
		"数据库查询耗时过长（置信度: %.0f%%）- 总耗时 %v，SQL执行占比 %.1f%%（网络时间: %v, 执行时间: %v）",
		HighConfidence*100,
		span.Duration,
		processRatio,
		breakdown.NetworkTime,
		breakdown.ProcessTime,
	)
}

func formatBusinessLogicAnalysis(span Span, breakdown *TimeBreakdown) string {
	processRatio := float64(0)
	if span.Duration > 0 {
		processRatio = float64(breakdown.ProcessTime) / float64(span.Duration) * 100
	}
	return fmt.Sprintf(
		"业务逻辑处理耗时过长 - 总耗时 %v，CPU/计算占比 %.1f%%（计算时间: %v, 等待时间: %v）",
		span.Duration,
		processRatio,
		breakdown.ProcessTime,
		breakdown.QueueTime+breakdown.NetworkTime,
	)
}

func formatCodeLocation(filepath string, lineno int) string {
	return filepath + ":" + string(rune(lineno))
}

func AlignTiming(parentSpan, childSpan Span) TimingAlignment {
	clientSend := parentSpan.StartTime
	clientRecv := parentSpan.EndTime
	serverRecv := childSpan.StartTime
	serverSend := childSpan.EndTime

	requestLatency := serverRecv.Sub(clientSend)
	responseLatency := clientRecv.Sub(serverSend)

	if requestLatency < 0 {
		requestLatency = 0
	}
	if responseLatency < 0 {
		responseLatency = 0
	}

	networkLatency := requestLatency + responseLatency
	serverProcessTime := serverSend.Sub(serverRecv)

	return TimingAlignment{
		ClientSendTime:    clientSend,
		ServerRecvTime:    serverRecv,
		ServerSendTime:    serverSend,
		ClientRecvTime:    clientRecv,
		NetworkLatency:    networkLatency,
		ServerProcessTime: serverProcessTime,
	}
}

func DiagnoseNetworkIssue(span Span, parentSpans []Span) *NetworkDiagnostic {
	diagnostic := &NetworkDiagnostic{}

	if span.TimeBreakdown != nil {
		totalTime := span.Duration
		if totalTime > 0 {
			diagnostic.NetworkDelayRatio = float64(span.TimeBreakdown.NetworkTime) / float64(totalTime)
		}
	}

	for _, parent := range parentSpans {
		if parent.SpanID == span.ParentID {
			alignment := AlignTiming(parent, span)
			totalTime := parent.Duration
			if totalTime > 0 {
				networkRatio := float64(alignment.NetworkLatency) / float64(totalTime)
				if networkRatio > diagnostic.NetworkDelayRatio {
					diagnostic.NetworkDelayRatio = networkRatio
				}
			}
		}
	}

	diagnostic.IsNetworkProblem = diagnostic.NetworkDelayRatio > NetworkRatioThreshold &&
		span.Duration > NetworkTimeMin

	if diagnostic.IsNetworkProblem {
		if diagnostic.NetworkDelayRatio > 0.8 {
			diagnostic.NetworkSeverity = "CRITICAL"
		} else {
			diagnostic.NetworkSeverity = "WARNING"
		}
	}

	return diagnostic
}

func ExtractTimeBreakdown(span Span) TimeBreakdown {
	breakdown := TimeBreakdown{}

	if attrs := span.Attributes; attrs != nil {
		if networkMs, ok := attrs["time.network_ms"].(float64); ok {
			breakdown.NetworkTime = time.Duration(networkMs) * time.Millisecond
		}
		if queueMs, ok := attrs["time.queue_ms"].(float64); ok {
			breakdown.QueueTime = time.Duration(queueMs) * time.Millisecond
		}
		if processMs, ok := attrs["time.process_ms"].(float64); ok {
			breakdown.ProcessTime = time.Duration(processMs) * time.Millisecond
		}
	}

	total := breakdown.NetworkTime + breakdown.QueueTime + breakdown.ProcessTime
	breakdown.OverheadTime = span.Duration - total
	if breakdown.OverheadTime < 0 {
		breakdown.OverheadTime = 0
	}

	return breakdown
}

func FindParentSpans(spans []Span, span Span) []Span {
	var parents []Span
	currentID := span.ParentID
	for currentID != "" {
		for _, s := range spans {
			if s.SpanID == currentID {
				parents = append(parents, s)
				currentID = s.ParentID
				break
			}
		}
		if len(parents) == 0 {
			break
		}
	}
	return parents
}

func CalculateConfidence(span Span, diagnostic *NetworkDiagnostic, issueType string) float64 {
	baseConfidence := MediumConfidence

	if diagnostic != nil && diagnostic.IsNetworkProblem {
		if diagnostic.NetworkDelayRatio > 0.8 {
			baseConfidence = HighConfidence
		} else if diagnostic.NetworkDelayRatio > 0.6 {
			baseConfidence = MediumConfidence
		}
	}

	if span.TimeBreakdown != nil {
		total := span.Duration
		switch issueType {
		case "NETWORK_DELAY":
			ratio := float64(span.TimeBreakdown.NetworkTime) / float64(total)
			if ratio > 0.7 {
				baseConfidence = math.Max(baseConfidence, HighConfidence)
			}
		case "SLOW_SQL", "SLOW_BUSINESS_LOGIC":
			ratio := float64(span.TimeBreakdown.ProcessTime) / float64(total)
			if ratio > 0.5 {
				baseConfidence = math.Max(baseConfidence, HighConfidence)
			}
		}
	}

	return baseConfidence
}

func buildTopology(spans []Span) []Node {
	spanMap := make(map[string]*Span)
	for i := range spans {
		spanMap[spans[i].SpanID] = &spans[i]
	}

	var nodes []Node
	for _, span := range spans {
		node := Node{
			ID:       span.SpanID,
			Name:     span.Operation,
			Service:  span.ServiceName,
			Duration: span.Duration.Milliseconds(),
		}

		var children []string
		for _, s := range spans {
			if s.ParentID == span.SpanID {
				children = append(children, s.SpanID)
			}
		}
		if len(children) > 0 {
			node.Children = children
		}

		nodes = append(nodes, node)
	}

	return nodes
}
