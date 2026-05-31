package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/perf"
	"github.com/cilium/ebpf/rlimit"
)

//go:generate go run github.com/cilium/ebpf/cmd/bpf2go bpf http_trace.bpf.c -- -I./headers

type HTTPEvent struct {
	PID         uint32  `json:"pid"`
	Comm        string  `json:"comm"`
	Method      string  `json:"method"`
	URL         string  `json:"url"`
	StatusCode  int     `json:"status_code"`
	LatencyMs   float64 `json:"latency_ms"`
	BodySize    int     `json:"body_size"`
	Timestamp   int64   `json:"timestamp"`
	SourceIP    string  `json:"source_ip"`
	DestIP      string  `json:"dest_ip"`
}

type pendingRequest struct {
	method    string
	url       string
	startTime time.Time
	bodySize  int
}

var (
	pendingRequests = make(map[uint32]*pendingRequest)
	backendURL      = flag.String("backend", "http://localhost:3000/api/events", "Backend server URL")
	filterPID       = flag.Uint("pid", 0, "Filter by process PID")
)

var (
	httpRequestRegex  = regexp.MustCompile(`^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\S+)\s+HTTP/`)
	httpResponseRegex = regexp.MustCompile(`^HTTP/\d\.\d\s+(\d{3})\s+`)
)

func main() {
	flag.Parse()

	if err := rlimit.RemoveMemlock(); err != nil {
		log.Fatalf("Failed to remove memlock limit: %v", err)
	}

	objs := bpfObjects{}
	if err := loadBpfObjects(&objs, nil); err != nil {
		log.Fatalf("Failed to load BPF objects: %v", err)
	}
	defer objs.Close()

	sendLink, err := link.Kprobe("tcp_sendmsg", objs.TcpSendmsgEntry, nil)
	if err != nil {
		log.Fatalf("Failed to attach tcp_sendmsg: %v", err)
	}
	defer sendLink.Close()

	recvLink, err := link.Kprobe("tcp_recvmsg", objs.TcpRecvmsgEntry, nil)
	if err != nil {
		log.Fatalf("Failed to attach tcp_recvmsg: %v", err)
	}
	defer recvLink.Close()

	rd, err := perf.NewReader(objs.Events, os.Getpagesize()*64)
	if err != nil {
		log.Fatalf("Failed to create perf reader: %v", err)
	}
	defer rd.Close()

	stopper := make(chan os.Signal, 1)
	signal.Notify(stopper, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-stopper
		if err := rd.Close(); err != nil {
			log.Fatalf("Failed to close perf reader: %v", err)
		}
	}()

	log.Println("eBPF HTTP tracer started...")
	log.Printf("Backend: %s", *backendURL)
	if *filterPID > 0 {
		log.Printf("Filtering PID: %d", *filterPID)
	}

	var event bpfEvent
	for {
		record, err := rd.Read()
		if err != nil {
			if err == perf.ErrClosed {
				return
			}
			log.Printf("Error reading from perf: %v", err)
			continue
		}

		if record.LostSamples != 0 {
			log.Printf("Lost %d samples", record.LostSamples)
			continue
		}

		if err := binary.Read(bytes.NewBuffer(record.RawSample), binary.LittleEndian, &event); err != nil {
			log.Printf("Error unmarshaling event: %v", err)
			continue
		}

		if *filterPID > 0 && event.Pid != uint32(*filterPID) {
			continue
		}

		processEvent(&event)
	}
}

func processEvent(event *bpfEvent) {
	if event.DataLen == 0 || event.DataLen > 2048 {
		return
	}

	if event.Pid == 0 {
		return
	}

	data := event.Data[:event.DataLen]
	dataStr := string(bytes.Trim(data, "\x00"))

	if len(dataStr) == 0 {
		return
	}

	if event.IsSend == 1 {
		if matches := httpRequestRegex.FindStringSubmatch(dataStr); len(matches) > 2 {
			method := matches[1]
			url := matches[2]

			if len(method) == 0 || len(url) == 0 {
				return
			}

			if len(url) > 2048 {
				url = url[:2048]
			}

			bodySize := calculateBodySize(dataStr)

			pendingRequests[event.Pid] = &pendingRequest{
				method:    method,
				url:       url,
				startTime: time.Now(),
				bodySize:  bodySize,
			}
		}
	} else {
		if req, ok := pendingRequests[event.Pid]; ok {
			if matches := httpResponseRegex.FindStringSubmatch(dataStr); len(matches) > 1 {
				statusCode := 0
				fmt.Sscanf(matches[1], "%d", &statusCode)

				if statusCode < 100 || statusCode > 599 {
					statusCode = 0
				}

				latency := time.Since(req.startTime).Milliseconds()
				if latency < 0 {
					latency = 0
				}

				comm := strings.Trim(string(event.Comm[:]), "\x00")
				if len(comm) > 16 {
					comm = comm[:16]
				}

				httpEvent := HTTPEvent{
					PID:        event.Pid,
					Comm:       comm,
					Method:     req.method,
					URL:        req.url,
					StatusCode: statusCode,
					LatencyMs:  float64(latency),
					BodySize:   req.bodySize,
					Timestamp:  time.Now().UnixNano() / int64(time.Millisecond),
				}

				sendToBackend(httpEvent)
				delete(pendingRequests, event.Pid)
			}
		}
	}
}

func calculateBodySize(data string) int {
	if len(data) > 65536 {
		data = data[:65536]
	}

	parts := strings.SplitN(data, "\r\n\r\n", 2)
	if len(parts) > 1 {
		bodyLen := len(parts[1])
		if bodyLen > 1048576 {
			return 1048576
		}
		return bodyLen
	}
	return 0
}

func sendToBackend(event HTTPEvent) {
	jsonData, err := json.Marshal(event)
	if err != nil {
		log.Printf("Error marshaling event: %v", err)
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(*backendURL, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("Error sending to backend: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Backend returned status: %d", resp.StatusCode)
	}
}
