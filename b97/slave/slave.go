package slave

import (
	"fmt"
	"log"
	"net"
	"sync"
	"time"
)

type SlaveDevice struct {
	ID                   byte
	HoldingRegisters     []uint16
	Coils                []bool
	IsRunning            bool
	IsStuck              bool
	Uptime               time.Time
	LastResponseTime     time.Time
	ConsecutiveNoResponse int
	mu                   sync.RWMutex
	listener             net.Listener
	port                 int
	initialRegisters     []uint16
	initialCoils         []bool
}

func NewSlaveDevice(id byte, holdingRegCount int, coilCount int) *SlaveDevice {
	regs := make([]uint16, holdingRegCount)
	coils := make([]bool, coilCount)
	return &SlaveDevice{
		ID:                   id,
		HoldingRegisters:     regs,
		Coils:                coils,
		IsRunning:            false,
		IsStuck:              false,
		Uptime:               time.Now(),
		LastResponseTime:     time.Now(),
		ConsecutiveNoResponse: 0,
		initialRegisters:     make([]uint16, holdingRegCount),
		initialCoils:         make([]bool, coilCount),
	}
}

func (s *SlaveDevice) Start(port int) error {
	s.mu.Lock()
	if s.IsRunning {
		s.mu.Unlock()
		return fmt.Errorf("slave %d already running", s.ID)
	}
	s.Uptime = time.Now()
	s.IsRunning = true
	s.IsStuck = false
	s.ConsecutiveNoResponse = 0
	s.LastResponseTime = time.Now()
	s.port = port
	copy(s.initialRegisters, s.HoldingRegisters)
	copy(s.initialCoils, s.Coils)
	s.mu.Unlock()

	addr := fmt.Sprintf(":%d", port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.listener = listener

	log.Printf("Slave %d started on port %d", s.ID, port)

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				s.mu.RLock()
				running := s.IsRunning
				s.mu.RUnlock()
				if !running {
					return
				}
				log.Printf("Slave %d accept error: %v", s.ID, err)
				continue
			}
			go s.handleConnection(conn)
		}
	}()

	return nil
}

func (s *SlaveDevice) WarmRestart() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("Slave %d: Performing warm restart (watchdog triggered)", s.ID)
	
	copy(s.HoldingRegisters, s.initialRegisters)
	copy(s.Coils, s.initialCoils)
	
	s.IsStuck = false
	s.ConsecutiveNoResponse = 0
	s.LastResponseTime = time.Now()
	s.Uptime = time.Now()
	
	log.Printf("Slave %d: Warm restart completed successfully", s.ID)
	return nil
}

func (s *SlaveDevice) SetStuck(stuck bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.IsStuck = stuck
}

func (s *SlaveDevice) IncrementNoResponse() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ConsecutiveNoResponse++
	return s.ConsecutiveNoResponse
}

func (s *SlaveDevice) ResetNoResponse() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ConsecutiveNoResponse = 0
	s.LastResponseTime = time.Now()
}

func (s *SlaveDevice) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.IsRunning {
		s.IsRunning = false
		if s.listener != nil {
			s.listener.Close()
		}
		log.Printf("Slave %d stopped", s.ID)
	}
}

func (s *SlaveDevice) handleConnection(conn net.Conn) {
	defer conn.Close()
	buf := make([]byte, 256)

	for {
		conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		n, err := conn.Read(buf)
		if err != nil {
			return
		}

		if n < 8 {
			continue
		}

		response := s.processRequest(buf[:n])
		if response != nil {
			conn.Write(response)
		}
	}
}

func (s *SlaveDevice) processRequest(req []byte) []byte {
	s.mu.RLock()
	isStuck := s.IsStuck
	s.mu.RUnlock()

	if isStuck {
		time.Sleep(10 * time.Second)
		return nil
	}

	if len(req) < 8 {
		return s.buildException(req, 0x01)
	}

	unitID := req[6]
	if unitID != s.ID {
		return nil
	}

	if len(req) >= 12 && req[7] == 0xFF && req[8] == 0xDE && req[9] == 0xAD && req[10] == 0xBE && req[11] == 0xEF {
		log.Printf("Slave %d: Received device stuck packet!", s.ID)
		s.mu.Lock()
		s.IsStuck = true
		s.mu.Unlock()
		return nil
	}

	functionCode := req[7]
	s.mu.RLock()
	defer s.mu.RUnlock()

	switch functionCode {
	case 0x01:
		return s.readCoils(req)
	case 0x03:
		return s.readHoldingRegisters(req)
	case 0x05:
		return s.writeSingleCoil(req)
	case 0x06:
		return s.writeSingleRegister(req)
	case 0x08:
		return s.diagnostic(req)
	case 0x0F:
		return s.writeMultipleCoils(req)
	case 0x10:
		return s.writeMultipleRegisters(req)
	default:
		return s.buildException(req, 0x01)
	}
}

func (s *SlaveDevice) diagnostic(req []byte) []byte {
	if len(req) < 12 {
		return s.buildException(req, 0x02)
	}

	subFunction := uint16(req[8])<<8 | uint16(req[9])

	switch subFunction {
	case 0x0001:
		response := make([]byte, 12)
		copy(response, req[:12])
		response[10] = 0xFF
		response[11] = 0x00
		return response
	case 0x0002:
		response := make([]byte, 12)
		copy(response, req[:12])
		response[10] = 0x00
		response[11] = 0x0A
		return response
	case 0x0004:
		response := make([]byte, 12)
		copy(response, req[:12])
		response[10] = 0x00
		response[11] = 0x00
		return response
	default:
		return s.buildException(req, 0x03)
	}
}

func (s *SlaveDevice) readCoils(req []byte) []byte {
	if len(req) < 12 {
		return s.buildException(req, 0x02)
	}

	startAddr := int(req[8])<<8 | int(req[9])
	quantity := int(req[10])<<8 | int(req[11])

	if startAddr < 0 || startAddr+quantity > len(s.Coils) {
		return s.buildException(req, 0x02)
	}

	byteCount := (quantity + 7) / 8
	response := make([]byte, 9+byteCount)

	copy(response[:8], req[:8])
	response[5] = byte(3 + byteCount)
	response[7] = 0x01
	response[8] = byte(byteCount)

	for i := 0; i < quantity; i++ {
		if s.Coils[startAddr+i] {
			response[9+i/8] |= 1 << (i % 8)
		}
	}

	return response
}

func (s *SlaveDevice) readHoldingRegisters(req []byte) []byte {
	if len(req) < 12 {
		return s.buildException(req, 0x02)
	}

	startAddr := int(req[8])<<8 | int(req[9])
	quantity := int(req[10])<<8 | int(req[11])

	if startAddr < 0 || startAddr+quantity > len(s.HoldingRegisters) {
		return s.buildException(req, 0x02)
	}

	byteCount := quantity * 2
	response := make([]byte, 9+byteCount)

	copy(response[:8], req[:8])
	response[5] = byte(3 + byteCount)
	response[7] = 0x03
	response[8] = byte(byteCount)

	for i := 0; i < quantity; i++ {
		reg := s.HoldingRegisters[startAddr+i]
		response[9+i*2] = byte(reg >> 8)
		response[9+i*2+1] = byte(reg & 0xFF)
	}

	return response
}

func (s *SlaveDevice) writeSingleCoil(req []byte) []byte {
	if len(req) < 12 {
		return s.buildException(req, 0x02)
	}

	addr := int(req[8])<<8 | int(req[9])
	value := req[10] == 0xFF

	if addr < 0 || addr >= len(s.Coils) {
		return s.buildException(req, 0x02)
	}

	s.Coils[addr] = value

	response := make([]byte, 12)
	copy(response, req[:12])
	return response
}

func (s *SlaveDevice) writeSingleRegister(req []byte) []byte {
	if len(req) < 12 {
		return s.buildException(req, 0x02)
	}

	addr := int(req[8])<<8 | int(req[9])
	value := uint16(req[10])<<8 | uint16(req[11])

	if addr < 0 || addr >= len(s.HoldingRegisters) {
		return s.buildException(req, 0x02)
	}

	s.HoldingRegisters[addr] = value

	response := make([]byte, 12)
	copy(response, req[:12])
	return response
}

func (s *SlaveDevice) writeMultipleCoils(req []byte) []byte {
	if len(req) < 13 {
		return s.buildException(req, 0x02)
	}

	startAddr := int(req[8])<<8 | int(req[9])
	quantity := int(req[10])<<8 | int(req[11])
	byteCount := int(req[12])

	if len(req) < 13+byteCount {
		return s.buildException(req, 0x02)
	}

	if startAddr < 0 || startAddr+quantity > len(s.Coils) {
		return s.buildException(req, 0x02)
	}

	for i := 0; i < quantity; i++ {
		byteIdx := i / 8
		bitIdx := i % 8
		s.Coils[startAddr+i] = (req[13+byteIdx] & (1 << bitIdx)) != 0
	}

	response := make([]byte, 12)
	copy(response, req[:12])
	return response
}

func (s *SlaveDevice) writeMultipleRegisters(req []byte) []byte {
	if len(req) < 13 {
		return s.buildException(req, 0x02)
	}

	startAddr := int(req[8])<<8 | int(req[9])
	quantity := int(req[10])<<8 | int(req[11])
	byteCount := int(req[12])

	if len(req) < 13+byteCount {
		return s.buildException(req, 0x02)
	}

	if startAddr < 0 || startAddr+quantity > len(s.HoldingRegisters) {
		return s.buildException(req, 0x02)
	}

	for i := 0; i < quantity; i++ {
		s.HoldingRegisters[startAddr+i] = uint16(req[13+i*2])<<8 | uint16(req[13+i*2+1])
	}

	response := make([]byte, 12)
	copy(response, req[:12])
	return response
}

func (s *SlaveDevice) buildException(req []byte, exceptionCode byte) []byte {
	response := make([]byte, 9)
	copy(response[:8], req[:8])
	response[5] = 3
	response[7] = req[7] | 0x80
	response[8] = exceptionCode
	return response
}

func (s *SlaveDevice) GetStatus() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return map[string]interface{}{
		"id":                       s.ID,
		"is_running":               s.IsRunning,
		"is_stuck":                 s.IsStuck,
		"uptime_seconds":           time.Since(s.Uptime).Seconds(),
		"consecutive_no_response":  s.ConsecutiveNoResponse,
		"last_response_seconds":    time.Since(s.LastResponseTime).Seconds(),
		"holding_registers":        len(s.HoldingRegisters),
		"coils":                    len(s.Coils),
	}
}

type SlaveManager struct {
	Slaves map[byte]*SlaveDevice
	mu     sync.RWMutex
}

func NewSlaveManager() *SlaveManager {
	return &SlaveManager{
		Slaves: make(map[byte]*SlaveDevice),
	}
}

func (sm *SlaveManager) AddSlave(id byte, holdingRegCount int, coilCount int) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if _, exists := sm.Slaves[id]; exists {
		return fmt.Errorf("slave %d already exists", id)
	}
	sm.Slaves[id] = NewSlaveDevice(id, holdingRegCount, coilCount)
	return nil
}

func (sm *SlaveManager) StartSlave(id byte, port int) error {
	sm.mu.RLock()
	slave, exists := sm.Slaves[id]
	sm.mu.RUnlock()
	if !exists {
		return fmt.Errorf("slave %d not found", id)
	}
	return slave.Start(port)
}

func (sm *SlaveManager) StopSlave(id byte) {
	sm.mu.RLock()
	slave, exists := sm.Slaves[id]
	sm.mu.RUnlock()
	if exists {
		slave.Stop()
	}
}

func (sm *SlaveManager) StopAll() {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	for _, slave := range sm.Slaves {
		slave.Stop()
	}
}

func (sm *SlaveManager) GetSlave(id byte) (*SlaveDevice, bool) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	slave, exists := sm.Slaves[id]
	return slave, exists
}

func (sm *SlaveManager) WarmRestartSlave(id byte) error {
	sm.mu.RLock()
	slave, exists := sm.Slaves[id]
	sm.mu.RUnlock()
	if !exists {
		return fmt.Errorf("slave %d not found", id)
	}
	return slave.WarmRestart()
}
