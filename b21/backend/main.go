package main

import (
	"C"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/aquasecurity/libbpfgo"
	"github.com/gorilla/websocket"
)

type SyscallEvent struct {
	Timestamp    int64    `json:"timestamp"`
	TimestampStr string   `json:"timestamp_str"`
	PID          uint32   `json:"pid"`
	TID          uint32   `json:"tid"`
	Comm         string   `json:"comm"`
	SyscallNum   uint32   `json:"syscall_num"`
	SyscallName  string   `json:"syscall_name"`
	Retval       int64    `json:"retval"`
	Args         []uint64 `json:"args"`
	ArgStrings   []string `json:"arg_strings"`
	ArgCount     uint32   `json:"arg_count"`
}

type RawSyscallEvent struct {
	Timestamp    uint64
	PID          uint32
	TID          uint32
	Comm         [16]byte
	SyscallNum   uint32
	SyscallName  [32]byte
	Retval       int64
	Args         [4]uint64
	ArgStrings   [4][128]byte
	ArgCount     uint32
}

type SyscallStats struct {
	Name      string  `json:"name"`
	Count     int64   `json:"count"`
	TotalTime float64 `json:"total_time"`
	MaxTime   float64 `json:"max_time"`
	MinTime   float64 `json:"min_time"`
	AvgTime   float64 `json:"avg_time"`
}

type FlameGraphNode struct {
	Name     string           `json:"name"`
	Value    float64          `json:"value"`
	Children []FlameGraphNode `json:"children,omitempty"`
}

type AggregatedStats struct {
	Syscalls       map[string]*SyscallStats `json:"-"`
	Events         []SyscallEvent           `json:"-"`
	StartTime      time.Time                `json:"start_time"`
	EndTime        time.Time                `json:"end_time"`
	TotalEvents    int64                    `json:"total_events"`
	TotalTimeNs    float64                  `json:"total_time_ns"`
	eventsMu       sync.RWMutex
}

var (
	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	clients   = make(map[*websocket.Conn]bool)
	clientsMu sync.Mutex
	broadcast = make(chan []byte, 100)
	
	stats = &AggregatedStats{
		Syscalls:  make(map[string]*SyscallStats),
		Events:    make([]SyscallEvent, 0),
		StartTime: time.Now(),
	}
	
	estimatedTimes = map[string]float64{
		"openat":   500000.0,
		"read":     200000.0,
		"write":    250000.0,
		"connect":  1000000.0,
	}
)

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	defer conn.Close()

	clientsMu.Lock()
	clients[conn] = true
	clientsMu.Unlock()

	log.Println("New client connected")

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			clientsMu.Lock()
			delete(clients, conn)
			clientsMu.Unlock()
			log.Println("Client disconnected")
			break
		}
	}
}

func handleBroadcast() {
	for {
		message := <-broadcast
		clientsMu.Lock()
		for conn := range clients {
			err := conn.WriteMessage(websocket.TextMessage, message)
			if err != nil {
				log.Println("Write error:", err)
				conn.Close()
				delete(clients, conn)
			}
		}
		clientsMu.Unlock()
	}
}

func formatTimestamp(ns uint64) string {
	t := time.Unix(0, int64(ns))
	return t.Format("2006-01-02 15:04:05.000000000")
}

func cStringToString(b []byte) string {
	for i, c := range b {
		if c == 0 {
			return string(b[:i])
		}
	}
	return string(b)
}

func updateStats(event SyscallEvent) {
	stats.eventsMu.Lock()
	defer stats.eventsMu.Unlock()
	
	stats.Events = append(stats.Events, event)
	if len(stats.Events) > 10000 {
		stats.Events = stats.Events[1000:]
	}
	stats.TotalEvents++
	stats.EndTime = time.Now()
	
	syscallName := event.SyscallName
	if syscallStat, ok := stats.Syscalls[syscallName]; ok {
		estimatedTime := estimatedTimes[syscallName]
		syscallStat.Count++
		syscallStat.TotalTime += estimatedTime
		if estimatedTime > syscallStat.MaxTime {
			syscallStat.MaxTime = estimatedTime
		}
		if estimatedTime < syscallStat.MinTime || syscallStat.MinTime == 0 {
			syscallStat.MinTime = estimatedTime
		}
		syscallStat.AvgTime = syscallStat.TotalTime / float64(syscallStat.Count)
	} else {
		estimatedTime := estimatedTimes[syscallName]
		if estimatedTime == 0 {
			estimatedTime = 300000.0
		}
		stats.Syscalls[syscallName] = &SyscallStats{
			Name:      syscallName,
			Count:     1,
			TotalTime: estimatedTime,
			MaxTime:   estimatedTime,
			MinTime:   estimatedTime,
			AvgTime:   estimatedTime,
		}
	}
	
	totalTime := 0.0
	for _, s := range stats.Syscalls {
		totalTime += s.TotalTime
	}
	stats.TotalTimeNs = totalTime
}

func buildFlameGraph() FlameGraphNode {
	stats.eventsMu.RLock()
	defer stats.eventsMu.RUnlock()
	
	root := FlameGraphNode{
		Name:  "nginx",
		Value: stats.TotalTimeNs,
	}
	
	totalByPID := make(map[uint32]float64)
	for _, event := range stats.Events {
		estimatedTime := estimatedTimes[event.SyscallName]
		if estimatedTime == 0 {
			estimatedTime = 300000.0
		}
		totalByPID[event.PID] += estimatedTime
	}
	
	type pidTime struct {
		pid  uint32
		time float64
	}
	var pids []pidTime
	for pid, t := range totalByPID {
		pids = append(pids, pidTime{pid, t})
	}
	sort.Slice(pids, func(i, j int) bool {
		return pids[i].time > pids[j].time
	})
	
	for _, pt := range pids {
		pidNode := FlameGraphNode{
			Name:  fmt.Sprintf("PID %d", pt.pid),
			Value: pt.time,
		}
		
		syscallByPid := make(map[string]float64)
		for _, event := range stats.Events {
			if event.PID == pt.pid {
				estimatedTime := estimatedTimes[event.SyscallName]
				if estimatedTime == 0 {
					estimatedTime = 300000.0
				}
				syscallByPid[event.SyscallName] += estimatedTime
			}
		}
		
		for syscallName, t := range syscallByPid {
			syscallNode := FlameGraphNode{
				Name:  syscallName,
				Value: t,
			}
			pidNode.Children = append(pidNode.Children, syscallNode)
		}
		
		sort.Slice(pidNode.Children, func(i, j int) bool {
			return pidNode.Children[i].Value > pidNode.Children[j].Value
		})
		
		root.Children = append(root.Children, pidNode)
	}
	
	return root
}

func handleFlameGraph(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	
	flameGraph := buildFlameGraph()
	json.NewEncoder(w).Encode(flameGraph)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	
	stats.eventsMu.RLock()
	defer stats.eventsMu.RUnlock()
	
	response := map[string]interface{}{
		"start_time":   stats.StartTime,
		"end_time":     stats.EndTime,
		"total_events": stats.TotalEvents,
		"total_time_ns": stats.TotalTimeNs,
		"syscalls":     stats.Syscalls,
	}
	
	json.NewEncoder(w).Encode(response)
}

func handleClear(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	
	stats.eventsMu.Lock()
	stats.Syscalls = make(map[string]*SyscallStats)
	stats.Events = make([]SyscallEvent, 0)
	stats.StartTime = time.Now()
	stats.TotalEvents = 0
	stats.TotalTimeNs = 0
	stats.eventsMu.Unlock()
	
	json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
}

func main() {
	bpfObjPath := flag.String("bpf", "", "Path to compiled BPF object")
	port := flag.String("port", "8080", "WebSocket server port")
	flag.Parse()

	if *bpfObjPath == "" {
		log.Fatal("Please provide path to BPF object with -bpf flag")
	}

	go handleBroadcast()

	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	http.HandleFunc("/api/flamegraph", handleFlameGraph)
	http.HandleFunc("/api/stats", handleStats)
	http.HandleFunc("/api/clear", handleClear)

	go func() {
		addr := ":" + *port
		log.Printf("Server starting on port %s", addr)
		log.Printf("  WebSocket: ws://localhost%s/ws", addr)
		log.Printf("  Health:    http://localhost%s/health", addr)
		log.Printf("  FlameGraph: http://localhost%s/api/flamegraph", addr)
		log.Printf("  Stats:     http://localhost%s/api/stats", addr)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatal("HTTP server error:", err)
		}
	}()

	module, err := libbpfgo.NewModuleFromFile(*bpfObjPath)
	if err != nil {
		log.Fatalf("Failed to load BPF object: %v", err)
	}
	defer module.Close()

	if err := module.BPFLoadObject(); err != nil {
		log.Fatalf("Failed to load BPF program: %v", err)
	}

	progEnter, err := module.GetProgram("syscall_enter")
	if err != nil {
		log.Fatalf("Failed to get syscall_enter program: %v", err)
	}

	if _, err := progEnter.AttachTracepoint("raw_syscalls", "sys_enter"); err != nil {
		log.Fatalf("Failed to attach sys_enter tracepoint: %v", err)
	}
	log.Println("Attached to raw_syscalls:sys_enter")

	progExit, err := module.GetProgram("syscall_exit")
	if err != nil {
		log.Fatalf("Failed to get syscall_exit program: %v", err)
	}

	if _, err := progExit.AttachTracepoint("raw_syscalls", "sys_exit"); err != nil {
		log.Fatalf("Failed to attach sys_exit tracepoint: %v", err)
	}
	log.Println("Attached to raw_syscalls:sys_exit")

	progSchedExit, err := module.GetProgram("sched_process_exit")
	if err != nil {
		log.Printf("Warning: Failed to get sched_process_exit program: %v", err)
	} else {
		if _, err := progSchedExit.AttachTracepoint("sched", "sched_process_exit"); err != nil {
			log.Printf("Warning: Failed to attach sched_process_exit tracepoint: %v", err)
		} else {
			log.Println("Attached to sched:sched_process_exit")
		}
	}

	eventsMap, err := module.GetMap("events")
	if err != nil {
		log.Fatalf("Failed to get events map: %v", err)
	}

	rb, err := eventsMap.InitRingBuf(func(data []byte) {
		if len(data) < 68 {
			log.Printf("Data too short: %d bytes", len(data))
			return
		}
		
		var rawEvent RawSyscallEvent
		
		rawEvent.Timestamp = *(*uint64)(unsafe.Pointer(&data[0]))
		rawEvent.PID = *(*uint32)(unsafe.Pointer(&data[8]))
		rawEvent.TID = *(*uint32)(unsafe.Pointer(&data[12]))
		
		for i := 0; i < 16; i++ {
			rawEvent.Comm[i] = data[16+i]
		}
		
		rawEvent.SyscallNum = *(*uint32)(unsafe.Pointer(&data[32]))
		
		for i := 0; i < 32; i++ {
			rawEvent.SyscallName[i] = data[36+i]
		}
		
		rawEvent.Retval = *(*int64)(unsafe.Pointer(&data[68]))
		
		for i := 0; i < 4; i++ {
			if 76+i*8+8 <= len(data) {
				rawEvent.Args[i] = *(*uint64)(unsafe.Pointer(&data[76+i*8]))
			}
		}
		
		offset := 108
		for i := 0; i < 4; i++ {
			for j := 0; j < 128; j++ {
				if offset+j < len(data) {
					rawEvent.ArgStrings[i][j] = data[offset+j]
				}
			}
			offset += 128
		}
		
		if offset < len(data) {
			rawEvent.ArgCount = *(*uint32)(unsafe.Pointer(&data[offset]))
		}

		event := SyscallEvent{
			Timestamp:    int64(rawEvent.Timestamp),
			TimestampStr: formatTimestamp(rawEvent.Timestamp),
			PID:          rawEvent.PID,
			TID:          rawEvent.TID,
			Comm:         cStringToString(rawEvent.Comm[:]),
			SyscallNum:   rawEvent.SyscallNum,
			SyscallName:  cStringToString(rawEvent.SyscallName[:]),
			Retval:       rawEvent.Retval,
			Args:         rawEvent.Args[:],
			ArgStrings: []string{
				cStringToString(rawEvent.ArgStrings[0][:]),
				cStringToString(rawEvent.ArgStrings[1][:]),
				cStringToString(rawEvent.ArgStrings[2][:]),
				cStringToString(rawEvent.ArgStrings[3][:]),
			},
			ArgCount: rawEvent.ArgCount,
		}

		updateStats(event)

		jsonData, err := json.Marshal(event)
		if err != nil {
			log.Printf("JSON marshal error: %v", err)
			return
		}

		select {
		case broadcast <- jsonData:
		default:
			log.Printf("Broadcast channel full, dropping event")
		}
	})
	if err != nil {
		log.Fatalf("Failed to create ring buffer: %v", err)
	}
	defer rb.Close()

	if err := rb.Start(); err != nil {
		log.Fatalf("Failed to start ring buffer: %v", err)
	}

	fmt.Println("=")
	fmt.Println("eBPF program loaded and attached successfully")
	fmt.Println("Monitoring nginx process for syscalls: openat, read, write, connect")
	fmt.Println("Press Ctrl+C to exit...")
	fmt.Println("=")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	fmt.Println("\nStopping...")
}

func roundTo(n float64, decimals int) float64 {
	shift := math.Pow(10, float64(decimals))
	return math.Round(n*shift) / shift
}
