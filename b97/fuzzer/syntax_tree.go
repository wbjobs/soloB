package fuzzer

import (
	"math/rand"
	"time"
)

type ModbusFunction struct {
	Code        byte
	Name        string
	Description string
	MinDataLen  int
	MaxDataLen  int
	IsRead      bool
	IsWrite     bool
}

var ModbusFunctions = map[byte]ModbusFunction{
	0x01: {Code: 0x01, Name: "Read Coils", Description: "Read multiple coils", MinDataLen: 4, MaxDataLen: 4, IsRead: true, IsWrite: false},
	0x02: {Code: 0x02, Name: "Read Discrete Inputs", Description: "Read discrete inputs", MinDataLen: 4, MaxDataLen: 4, IsRead: true, IsWrite: false},
	0x03: {Code: 0x03, Name: "Read Holding Registers", Description: "Read holding registers", MinDataLen: 4, MaxDataLen: 4, IsRead: true, IsWrite: false},
	0x04: {Code: 0x04, Name: "Read Input Registers", Description: "Read input registers", MinDataLen: 4, MaxDataLen: 4, IsRead: true, IsWrite: false},
	0x05: {Code: 0x05, Name: "Write Single Coil", Description: "Write single coil", MinDataLen: 4, MaxDataLen: 4, IsRead: false, IsWrite: true},
	0x06: {Code: 0x06, Name: "Write Single Register", Description: "Write single register", MinDataLen: 4, MaxDataLen: 4, IsRead: false, IsWrite: true},
	0x07: {Code: 0x07, Name: "Read Exception Status", Description: "Read exception status", MinDataLen: 0, MaxDataLen: 0, IsRead: true, IsWrite: false},
	0x08: {Code: 0x08, Name: "Diagnostics", Description: "Diagnostic functions", MinDataLen: 4, MaxDataLen: 4, IsRead: false, IsWrite: false},
	0x0B: {Code: 0x0B, Name: "Get Comm Event Counter", Description: "Get communication event counter", MinDataLen: 0, MaxDataLen: 0, IsRead: true, IsWrite: false},
	0x0C: {Code: 0x0C, Name: "Get Comm Event Log", Description: "Get communication event log", MinDataLen: 0, MaxDataLen: 0, IsRead: true, IsWrite: false},
	0x0F: {Code: 0x0F, Name: "Write Multiple Coils", Description: "Write multiple coils", MinDataLen: 5, MaxDataLen: 253, IsRead: false, IsWrite: true},
	0x10: {Code: 0x10, Name: "Write Multiple Registers", Description: "Write multiple registers", MinDataLen: 5, MaxDataLen: 253, IsRead: false, IsWrite: true},
	0x11: {Code: 0x11, Name: "Report Slave ID", Description: "Report slave ID", MinDataLen: 0, MaxDataLen: 0, IsRead: true, IsWrite: false},
	0x14: {Code: 0x14, Name: "Read File Record", Description: "Read file record", MinDataLen: 1, MaxDataLen: 253, IsRead: true, IsWrite: false},
	0x15: {Code: 0x15, Name: "Write File Record", Description: "Write file record", MinDataLen: 1, MaxDataLen: 253, IsRead: false, IsWrite: true},
	0x16: {Code: 0x16, Name: "Mask Write Register", Description: "Mask write register", MinDataLen: 6, MaxDataLen: 6, IsRead: false, IsWrite: true},
	0x17: {Code: 0x17, Name: "Read/Write Multiple Registers", Description: "Read/write multiple registers", MinDataLen: 9, MaxDataLen: 253, IsRead: true, IsWrite: true},
	0x18: {Code: 0x18, Name: "Read FIFO Queue", Description: "Read FIFO queue", MinDataLen: 2, MaxDataLen: 2, IsRead: true, IsWrite: false},
}

type SyntaxMutationType int

const (
	MutInvalidAddress SyntaxMutationType = iota
	MutInvalidQuantity
	MutReadOnlyWrite
	MutInvalidFunctionCombination
	MutBoundaryValue
	MutDataLengthMismatch
	MutReservedFunction
	MutAddressOverflow
)

type SyntaxTreeMutator struct {
	rand           *rand.Rand
	MaxRegisters   uint16
	MaxCoils       uint16
	MaxQuantity    uint16
}

func NewSyntaxTreeMutator() *SyntaxTreeMutator {
	return &SyntaxTreeMutator{
		rand:         rand.New(rand.NewSource(time.Now().UnixNano())),
		MaxRegisters: 100,
		MaxCoils:     100,
		MaxQuantity:  125,
	}
}

func (stm *SyntaxTreeMutator) MutatePacket(unitID byte) ([]byte, SyntaxMutationType, string) {
	mutationType := SyntaxMutationType(stm.rand.Intn(8))
	
	var functionCode byte
	validFunctions := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0F, 0x10, 0x17}
	functionCode = validFunctions[stm.rand.Intn(len(validFunctions))]
	
	switch mutationType {
	case MutInvalidAddress:
		return stm.mutateInvalidAddress(unitID, functionCode), mutationType, "Invalid memory address"
	case MutInvalidQuantity:
		return stm.mutateInvalidQuantity(unitID, functionCode), mutationType, "Invalid quantity value"
	case MutReadOnlyWrite:
		return stm.mutateReadOnlyWrite(unitID), mutationType, "Write to read-only memory"
	case MutInvalidFunctionCombination:
		return stm.mutateInvalidFunctionCombination(unitID), mutationType, "Invalid function combination"
	case MutBoundaryValue:
		return stm.mutateBoundaryValue(unitID, functionCode), mutationType, "Boundary value test"
	case MutDataLengthMismatch:
		return stm.mutateDataLengthMismatch(unitID, functionCode), mutationType, "Data length mismatch"
	case MutReservedFunction:
		return stm.mutateReservedFunction(unitID), mutationType, "Use reserved/undefined function"
	case MutAddressOverflow:
		return stm.mutateAddressOverflow(unitID, functionCode), mutationType, "Address range overflow"
	default:
		return stm.mutateInvalidAddress(unitID, functionCode), mutationType, "Default mutation"
	}
}

func (stm *SyntaxTreeMutator) mutateInvalidAddress(unitID byte, functionCode byte) []byte {
	packet := make([]byte, 12)
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = functionCode
	
	invalidAddr := stm.MaxRegisters + 100 + uint16(stm.rand.Intn(1000))
	packet[8] = byte(invalidAddr >> 8)
	packet[9] = byte(invalidAddr & 0xFF)
	packet[10] = 0x00
	packet[11] = 0x01
	
	return packet
}

func (stm *SyntaxTreeMutator) mutateInvalidQuantity(unitID byte, functionCode byte) []byte {
	packet := make([]byte, 12)
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = functionCode
	packet[8] = 0x00
	packet[9] = 0x00
	
	invalidQuantities := []uint16{0, 0xFFFF, stm.MaxQuantity + 100, 0x0100}
	qty := invalidQuantities[stm.rand.Intn(len(invalidQuantities))]
	packet[10] = byte(qty >> 8)
	packet[11] = byte(qty & 0xFF)
	
	return packet
}

func (stm *SyntaxTreeMutator) mutateReadOnlyWrite(unitID byte) []byte {
	writeFunctions := []byte{0x05, 0x06, 0x0F, 0x10}
	functionCode := writeFunctions[stm.rand.Intn(len(writeFunctions))]
	
	packet := make([]byte, 12)
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = functionCode
	
	if functionCode == 0x05 {
		packet[8] = 0x00
		packet[9] = 0x00
		packet[10] = 0xFF
		packet[11] = 0x00
	} else if functionCode == 0x06 {
		packet[8] = 0x00
		packet[9] = 0x00
		packet[10] = 0x12
		packet[11] = 0x34
	} else {
		packet[8] = 0x00
		packet[9] = 0x00
		packet[10] = 0x00
		packet[11] = 0x0A
	}
	
	return packet
}

func (stm *SyntaxTreeMutator) mutateInvalidFunctionCombination(unitID byte) []byte {
	packet := make([]byte, 12)
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = 0x17
	
	readAddr := uint16(0)
	readQty := uint16(0)
	writeAddr := uint16(10)
	writeQty := uint16(0)
	
	packet[8] = byte(readAddr >> 8)
	packet[9] = byte(readAddr & 0xFF)
	packet[10] = byte(readQty >> 8)
	packet[11] = byte(readQty & 0xFF)
	
	extended := make([]byte, 16)
	copy(extended[:12], packet)
	extended[12] = byte(writeAddr >> 8)
	extended[13] = byte(writeAddr & 0xFF)
	extended[14] = byte(writeQty >> 8)
	extended[15] = byte(writeQty & 0xFF)
	extended[5] = 0x0A
	
	return extended
}

func (stm *SyntaxTreeMutator) mutateBoundaryValue(unitID byte, functionCode byte) []byte {
	packet := make([]byte, 12)
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = functionCode
	
	boundaryValues := []uint16{0x0000, 0x0001, 0xFFFE, 0xFFFF, stm.MaxRegisters - 1}
	addr := boundaryValues[stm.rand.Intn(len(boundaryValues))]
	packet[8] = byte(addr >> 8)
	packet[9] = byte(addr & 0xFF)
	packet[10] = 0x00
	packet[11] = 0x7D
	
	return packet
}

func (stm *SyntaxTreeMutator) mutateDataLengthMismatch(unitID byte, functionCode byte) []byte {
	baseLen := 12
	extraLen := stm.rand.Intn(20) + 1
	packet := make([]byte, baseLen+extraLen)
	
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = byte((len(packet) - 6) >> 8)
	packet[5] = byte((len(packet) - 6) & 0xFF)
	packet[6] = unitID
	packet[7] = functionCode
	packet[8] = 0x00
	packet[9] = 0x00
	packet[10] = 0x00
	packet[11] = 0x0A
	
	for i := 12; i < len(packet); i++ {
		packet[i] = byte(stm.rand.Intn(256))
	}
	
	packet[5] = byte(100)
	
	return packet
}

func (stm *SyntaxTreeMutator) mutateReservedFunction(unitID byte) []byte {
	reservedCodes := []byte{0x09, 0x0A, 0x0D, 0x0E, 0x12, 0x13, 0x19, 0x1A, 0x7E, 0x7F}
	functionCode := reservedCodes[stm.rand.Intn(len(reservedCodes))]
	
	packet := make([]byte, 12)
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = functionCode
	packet[8] = 0x00
	packet[9] = 0x00
	packet[10] = 0x00
	packet[11] = 0x01
	
	return packet
}

func (stm *SyntaxTreeMutator) mutateAddressOverflow(unitID byte, functionCode byte) []byte {
	packet := make([]byte, 12)
	packet[0] = byte(stm.rand.Intn(256))
	packet[1] = byte(stm.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = functionCode
	
	startAddr := stm.MaxRegisters - 50
	qty := uint16(100)
	
	packet[8] = byte(startAddr >> 8)
	packet[9] = byte(startAddr & 0xFF)
	packet[10] = byte(qty >> 8)
	packet[11] = byte(qty & 0xFF)
	
	return packet
}

func (s SyntaxMutationType) String() string {
	switch s {
	case MutInvalidAddress:
		return "Invalid address"
	case MutInvalidQuantity:
		return "Invalid quantity"
	case MutReadOnlyWrite:
		return "Write to read-only"
	case MutInvalidFunctionCombination:
		return "Invalid function combination"
	case MutBoundaryValue:
		return "Boundary value"
	case MutDataLengthMismatch:
		return "Data length mismatch"
	case MutReservedFunction:
		return "Reserved function"
	case MutAddressOverflow:
		return "Address overflow"
	default:
		return "Unknown mutation"
	}
}
