package agent

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

const TraceparentHeader = "traceparent"

type TraceContext struct {
	Version    byte
	TraceID    string
	SpanID     string
	TraceFlags byte
}

func NewTraceContext() *TraceContext {
	return &TraceContext{
		Version:    0x00,
		TraceID:    generateID(16),
		SpanID:     generateID(8),
		TraceFlags: 0x01,
	}
}

func (tc *TraceContext) FromHeader(header string) error {
	parts := strings.Split(header, "-")
	if len(parts) != 4 {
		return fmt.Errorf("invalid traceparent format")
	}

	versionBytes, err := hex.DecodeString(parts[0])
	if err != nil || len(versionBytes) != 1 {
		return fmt.Errorf("invalid version")
	}
	tc.Version = versionBytes[0]

	if len(parts[1]) != 32 {
		return fmt.Errorf("invalid trace-id length")
	}
	tc.TraceID = parts[1]

	if len(parts[2]) != 16 {
		return fmt.Errorf("invalid span-id length")
	}
	tc.SpanID = parts[2]

	flagsBytes, err := hex.DecodeString(parts[3])
	if err != nil || len(flagsBytes) != 1 {
		return fmt.Errorf("invalid trace-flags")
	}
	tc.TraceFlags = flagsBytes[0]

	return nil
}

func (tc *TraceContext) ToHeader() string {
	return fmt.Sprintf(
		"%02x-%s-%s-%02x",
		tc.Version,
		tc.TraceID,
		tc.SpanID,
		tc.TraceFlags,
	)
}

func (tc *TraceContext) NewChildSpan() *TraceContext {
	return &TraceContext{
		Version:    tc.Version,
		TraceID:    tc.TraceID,
		SpanID:     generateID(8),
		TraceFlags: tc.TraceFlags,
	}
}

func (tc *TraceContext) IsSampled() bool {
	return tc.TraceFlags&0x01 != 0
}

func (tc *TraceContext) SetSampled(sampled bool) {
	if sampled {
		tc.TraceFlags |= 0x01
	} else {
		tc.TraceFlags &= 0xFE
	}
}

func generateID(bytesCount int) string {
	b := make([]byte, bytesCount)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
