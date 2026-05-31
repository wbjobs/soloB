package detector

import (
	"log"
	"net"
	"sync"
	"time"
)

type ResponseStatus int

const (
	StatusOK ResponseStatus = iota
	StatusTimeout
	StatusInvalidData
	StatusConnectionRefused
	StatusExceptionResponse
	StatusInvalidCRC
	StatusWatchdogRecovered
)

const WatchdogThreshold = 3

type TestResult struct {
	Timestamp           time.Time
	SlaveID             byte
	FuzzType            string
	FuzzDesc            string
	RequestPacket       []byte
	ResponsePacket      []byte
	Status              ResponseStatus
	StatusDesc          string
	ResponseTime        time.Duration
	WatchdogTriggered   bool
	WatchdogRecovered   bool
}

type SlaveWatchdog struct {
	ConsecutiveFailures int
	LastFailureTime     time.Time
	RecoveryCount       int
	IsRecovering        bool
}

type Detector struct {
	timeout     time.Duration
	mu          sync.Mutex
	Results     []*TestResult
	SlaveIPs    map[byte]string
	Watchdogs   map[byte]*SlaveWatchdog
	SlaveManager interface{}
}

func NewDetector(timeoutSec int) *Detector {
	return &Detector{
		timeout:   time.Duration(timeoutSec) * time.Second,
		Results:   make([]*TestResult, 0),
		SlaveIPs:  make(map[byte]string),
		Watchdogs: make(map[byte]*SlaveWatchdog),
	}
}

func (d *Detector) SetSlaveManager(sm interface{}) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.SlaveManager = sm
}

type SlaveManagerInterface interface {
	WarmRestartSlave(id byte) error
	GetSlave(id byte) (*interface{}, bool)
}

func (d *Detector) AddSlave(slaveID byte, address string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.SlaveIPs[slaveID] = address
	d.Watchdogs[slaveID] = &SlaveWatchdog{
		ConsecutiveFailures: 0,
		LastFailureTime:     time.Now(),
		RecoveryCount:       0,
		IsRecovering:        false,
	}
}

func (d *Detector) SendRecoveryCommand(slaveID byte) error {
	addr, exists := d.SlaveIPs[slaveID]
	if !exists {
		return nil
	}

	if sm, ok := d.SlaveManager.(interface{ WarmRestartSlave(byte) error }); ok {
		return sm.WarmRestartSlave(slaveID)
	}

	log.Printf("Watchdog: Sending soft reset command to slave %d via Modbus...", slaveID)
	
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()

	resetPacket := []byte{0x00, 0x01, 0x00, 0x00, 0x00, 0x06, slaveID, 0x08, 0x00, 0x04, 0x00, 0x00}
	conn.Write(resetPacket)
	
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	resp := make([]byte, 12)
	conn.Read(resp)
	
	log.Printf("Watchdog: Recovery command sent to slave %d", slaveID)
	return nil
}

func (d *Detector) CheckWatchdog(slaveID byte, isSuccess bool) (bool, bool) {
	watchdog, exists := d.Watchdogs[slaveID]
	if !exists {
		return false, false
	}

	if isSuccess {
		watchdog.ConsecutiveFailures = 0
		watchdog.IsRecovering = false
		return false, false
	}

	watchdog.ConsecutiveFailures++
	watchdog.LastFailureTime = time.Now()

	triggered := watchdog.ConsecutiveFailures >= WatchdogThreshold
	
	if triggered && !watchdog.IsRecovering {
		watchdog.IsRecovering = true
		watchdog.RecoveryCount++
		log.Printf("Watchdog: Slave %d failed %d consecutive times, triggering recovery", slaveID, watchdog.ConsecutiveFailures)
		return triggered, true
	}

	return triggered, false
}

func (d *Detector) SendAndDetect(slaveID byte, request []byte, fuzzType string, fuzzDesc string) *TestResult {
	d.mu.Lock()
	addr, exists := d.SlaveIPs[slaveID]
	d.mu.Unlock()

	result := &TestResult{
		Timestamp:         time.Now(),
		SlaveID:           slaveID,
		FuzzType:          fuzzType,
		FuzzDesc:          fuzzDesc,
		RequestPacket:     request,
		Status:            StatusOK,
		StatusDesc:        "OK",
		WatchdogTriggered: false,
		WatchdogRecovered: false,
	}

	if !exists {
		result.Status = StatusConnectionRefused
		result.StatusDesc = "Slave not configured"
		d.addResult(result)
		return result
	}

	startTime := time.Now()
	conn, err := net.DialTimeout("tcp", addr, d.timeout)
	result.ResponseTime = time.Since(startTime)

	if err != nil {
		result.Status = StatusConnectionRefused
		result.StatusDesc = "Connection refused: " + err.Error()
		d.mu.Lock()
		_, shouldRecover := d.CheckWatchdog(slaveID, false)
		d.mu.Unlock()
		if shouldRecover {
			result.WatchdogTriggered = true
			go d.SendRecoveryCommand(slaveID)
		}
		d.addResult(result)
		return result
	}
	defer conn.Close()

	_, err = conn.Write(request)
	if err != nil {
		result.Status = StatusConnectionRefused
		result.StatusDesc = "Write error: " + err.Error()
		d.mu.Lock()
		_, shouldRecover := d.CheckWatchdog(slaveID, false)
		d.mu.Unlock()
		if shouldRecover {
			result.WatchdogTriggered = true
			go d.SendRecoveryCommand(slaveID)
		}
		d.addResult(result)
		return result
	}

	response := make([]byte, 512)
	conn.SetReadDeadline(time.Now().Add(d.timeout))
	n, err := conn.Read(response)
	result.ResponseTime = time.Since(startTime)

	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			result.Status = StatusTimeout
			result.StatusDesc = "Response timeout"
		} else {
			result.Status = StatusConnectionRefused
			result.StatusDesc = "Read error: " + err.Error()
		}
		d.mu.Lock()
		_, shouldRecover := d.CheckWatchdog(slaveID, false)
		d.mu.Unlock()
		if shouldRecover {
			result.WatchdogTriggered = true
			go d.SendRecoveryCommand(slaveID)
		}
		d.addResult(result)
		return result
	}

	result.ResponsePacket = response[:n]
	d.analyzeResponse(result)
	
	d.mu.Lock()
	isSuccess := result.Status == StatusOK
	_, shouldRecover := d.CheckWatchdog(slaveID, isSuccess)
	d.mu.Unlock()
	
	if shouldRecover {
		result.WatchdogTriggered = true
		go d.SendRecoveryCommand(slaveID)
	}
	
	d.addResult(result)
	return result
}

func (d *Detector) analyzeResponse(result *TestResult) {
	resp := result.ResponsePacket

	if len(resp) < 8 {
		result.Status = StatusInvalidData
		result.StatusDesc = "Response too short"
		return
	}

	if len(resp) >= 9 && (resp[7]&0x80) != 0 {
		result.Status = StatusExceptionResponse
		exceptionCode := resp[8]
		exceptions := map[byte]string{
			0x01: "Illegal function",
			0x02: "Illegal data address",
			0x03: "Illegal data value",
			0x04: "Server device failure",
			0x05: "Acknowledge",
			0x06: "Server device busy",
			0x08: "Memory parity error",
			0x0A: "Gateway path unavailable",
			0x0B: "Gateway target device failed to respond",
		}
		if desc, ok := exceptions[exceptionCode]; ok {
			result.StatusDesc = "Exception: " + desc
		} else {
			result.StatusDesc = "Exception: Unknown code"
		}
		return
	}

	lengthField := int(resp[4])<<8 | int(resp[5])
	if len(resp) != 6+lengthField {
		result.Status = StatusInvalidData
		result.StatusDesc = "Length mismatch"
		return
	}

	if d.checkCRC(result.ResponsePacket) {
		result.Status = StatusInvalidCRC
		result.StatusDesc = "Invalid CRC checksum"
		return
	}
}

func (d *Detector) checkCRC(packet []byte) bool {
	if len(packet) < 4 {
		return false
	}
	return false
}

func (d *Detector) addResult(result *TestResult) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.Results = append(d.Results, result)
	if len(d.Results) > 10000 {
		d.Results = d.Results[len(d.Results)-10000:]
	}
}

func (d *Detector) GetResults() []*TestResult {
	d.mu.Lock()
	defer d.mu.Unlock()
	results := make([]*TestResult, len(d.Results))
	copy(results, d.Results)
	return results
}

func (d *Detector) GetAnomalies() []*TestResult {
	d.mu.Lock()
	defer d.mu.Unlock()
	anomalies := make([]*TestResult, 0)
	for _, r := range d.Results {
		if r.Status != StatusOK {
			anomalies = append(anomalies, r)
		}
	}
	return anomalies
}

func (d *Detector) GetStatistics() map[string]interface{} {
	d.mu.Lock()
	defer d.mu.Unlock()

	stats := map[string]interface{}{
		"total_tests":       len(d.Results),
		"timeout_count":     0,
		"invalid_data":      0,
		"connection_errors": 0,
		"exceptions":        0,
		"invalid_crc":       0,
		"success_count":     0,
		"watchdog_triggers": 0,
		"slave_watchdogs":   make(map[byte]map[string]interface{}),
	}

	for _, r := range d.Results {
		if r.WatchdogTriggered {
			stats["watchdog_triggers"] = stats["watchdog_triggers"].(int) + 1
		}
		switch r.Status {
		case StatusOK:
			stats["success_count"] = stats["success_count"].(int) + 1
		case StatusTimeout:
			stats["timeout_count"] = stats["timeout_count"].(int) + 1
		case StatusInvalidData:
			stats["invalid_data"] = stats["invalid_data"].(int) + 1
		case StatusConnectionRefused:
			stats["connection_errors"] = stats["connection_errors"].(int) + 1
		case StatusExceptionResponse:
			stats["exceptions"] = stats["exceptions"].(int) + 1
		case StatusInvalidCRC:
			stats["invalid_crc"] = stats["invalid_crc"].(int) + 1
		}
	}

	slaveStats := make(map[byte]map[string]interface{})
	for slaveID, wd := range d.Watchdogs {
		slaveStats[slaveID] = map[string]interface{}{
			"consecutive_failures": wd.ConsecutiveFailures,
			"recovery_count":        wd.RecoveryCount,
			"is_recovering":         wd.IsRecovering,
		}
	}
	stats["slave_watchdogs"] = slaveStats

	return stats
}

func (d *Detector) ManualRecovery(slaveID byte) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	
	log.Printf("Manual recovery triggered for slave %d", slaveID)
	return d.SendRecoveryCommand(slaveID)
}

func (s ResponseStatus) String() string {
	switch s {
	case StatusOK:
		return "OK"
	case StatusTimeout:
		return "TIMEOUT"
	case StatusInvalidData:
		return "INVALID_DATA"
	case StatusConnectionRefused:
		return "CONNECTION_ERROR"
	case StatusExceptionResponse:
		return "EXCEPTION"
	case StatusInvalidCRC:
		return "INVALID_CRC"
	case StatusWatchdogRecovered:
		return "WATCHDOG_RECOVERED"
	default:
		return "UNKNOWN"
	}
}
