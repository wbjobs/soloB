package fuzzer

import (
	"math/rand"
	"time"
)

type FuzzType int

const (
	FuzzBitFlip FuzzType = iota
	FuzzInvalidFunctionCode
	FuzzLengthOverflow
	FuzzInvalidUnitID
	FuzzRandomBytes
	FuzzDeviceStuck
	FuzzSyntaxTree
)

type Mutator struct {
	rand         *rand.Rand
	syntaxMutator *SyntaxTreeMutator
}

func NewMutator() *Mutator {
	return &Mutator{
		rand:         rand.New(rand.NewSource(time.Now().UnixNano())),
		syntaxMutator: NewSyntaxTreeMutator(),
	}
}

func (m *Mutator) FuzzPacket(packet []byte) ([]byte, FuzzType, string) {
	fuzzType := FuzzType(m.rand.Intn(7))
	switch fuzzType {
	case FuzzBitFlip:
		return m.bitFlip(packet), fuzzType, "Bit flip mutation"
	case FuzzInvalidFunctionCode:
		return m.invalidFunctionCode(packet), fuzzType, "Invalid function code"
	case FuzzLengthOverflow:
		return m.lengthOverflow(packet), fuzzType, "Length overflow"
	case FuzzInvalidUnitID:
		return m.invalidUnitID(packet), fuzzType, "Invalid unit ID"
	case FuzzRandomBytes:
		return m.randomBytes(packet), fuzzType, "Random bytes insertion"
	case FuzzDeviceStuck:
		return m.deviceStuckPacket(packet), fuzzType, "Device stuck simulation"
	case FuzzSyntaxTree:
		unitID := byte(1)
		if len(packet) > 6 {
			unitID = packet[6]
		}
		result, mutType, desc := m.syntaxMutator.MutatePacket(unitID)
		return result, fuzzType, "Syntax tree mutation: " + desc + " (" + mutType.String() + ")"
	default:
		return packet, fuzzType, "No mutation"
	}
}

func (m *Mutator) bitFlip(packet []byte) []byte {
	if len(packet) == 0 {
		return packet
	}
	result := make([]byte, len(packet))
	copy(result, packet)

	numBits := 1 + m.rand.Intn(5)
	for i := 0; i < numBits; i++ {
		bytePos := m.rand.Intn(len(result))
		bitPos := m.rand.Intn(8)
		result[bytePos] ^= 1 << bitPos
	}
	return result
}

func (m *Mutator) invalidFunctionCode(packet []byte) []byte {
	if len(packet) < 8 {
		return packet
	}
	result := make([]byte, len(packet))
	copy(result, packet)

	invalidCodes := []byte{0x00, 0x0A, 0x1A, 0x2A, 0x3A, 0x4A, 0x5A, 0x6A, 0x7A, 0xFA, 0xFF}
	result[7] = invalidCodes[m.rand.Intn(len(invalidCodes))]
	return result
}

func (m *Mutator) lengthOverflow(packet []byte) []byte {
	result := make([]byte, len(packet))
	copy(result, packet)

	if len(result) >= 6 {
		overflowLen := 200 + m.rand.Intn(300)
		result[4] = byte(overflowLen >> 8)
		result[5] = byte(overflowLen & 0xFF)
	}

	extra := make([]byte, m.rand.Intn(256))
	m.rand.Read(extra)
	result = append(result, extra...)
	return result
}

func (m *Mutator) invalidUnitID(packet []byte) []byte {
	if len(packet) < 7 {
		return packet
	}
	result := make([]byte, len(packet))
	copy(result, packet)

	invalidIDs := []byte{0x00, 0xFF, 0xF0, 0x0F, 0xAA, 0x55}
	result[6] = invalidIDs[m.rand.Intn(len(invalidIDs))]
	return result
}

func (m *Mutator) randomBytes(packet []byte) []byte {
	result := make([]byte, len(packet))
	copy(result, packet)

	start := m.rand.Intn(len(result))
	end := start + 1 + m.rand.Intn(min(5, len(result)-start))
	for i := start; i < end; i++ {
		result[i] = byte(m.rand.Intn(256))
	}
	return result
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (m *Mutator) deviceStuckPacket(packet []byte) []byte {
	result := make([]byte, len(packet))
	copy(result, packet)
	if len(result) >= 12 {
		result[7] = 0xFF
		result[8] = 0xDE
		result[9] = 0xAD
		result[10] = 0xBE
		result[11] = 0xEF
	}
	return result
}

func (m *Mutator) GenerateNormalPacket(unitID byte, functionCode byte) []byte {
	packet := make([]byte, 12)
	packet[0] = byte(m.rand.Intn(256))
	packet[1] = byte(m.rand.Intn(256))
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = functionCode
	packet[8] = 0x00
	packet[9] = 0x00
	packet[10] = 0x00
	packet[11] = 0x0A
	return packet
}

type ModbusMaster struct {
	mutator       *Mutator
	syntaxMutator *SyntaxTreeMutator
}

func NewModbusMaster() *ModbusMaster {
	return &ModbusMaster{
		mutator:       NewMutator(),
		syntaxMutator: NewSyntaxTreeMutator(),
	}
}

func (mm *ModbusMaster) GenerateFuzzedPacket() ([]byte, FuzzType, string) {
	normalPacket := mm.mutator.GenerateNormalPacket(0x01, 0x03)
	return mm.mutator.FuzzPacket(normalPacket)
}

func (mm *ModbusMaster) GenerateSyntaxTreePacket(unitID byte) ([]byte, string, string) {
	packet, mutType, desc := mm.syntaxMutator.MutatePacket(unitID)
	return packet, mutType.String(), desc
}

func (mm *ModbusMaster) GenerateNormalReadPacket(unitID byte, startAddr uint16, quantity uint16) []byte {
	packet := make([]byte, 12)
	packet[0] = 0x00
	packet[1] = 0x01
	packet[2] = 0x00
	packet[3] = 0x00
	packet[4] = 0x00
	packet[5] = 0x06
	packet[6] = unitID
	packet[7] = 0x03
	packet[8] = byte(startAddr >> 8)
	packet[9] = byte(startAddr & 0xFF)
	packet[10] = byte(quantity >> 8)
	packet[11] = byte(quantity & 0xFF)
	return packet
}

func (mm *ModbusMaster) GetAvailableFunctions() map[string]interface{} {
	result := make(map[string]interface{})
	for code, fn := range ModbusFunctions {
		result[fn.Name] = map[string]interface{}{
			"code":         code,
			"description":  fn.Description,
			"is_read":      fn.IsRead,
			"is_write":     fn.IsWrite,
			"min_data_len": fn.MinDataLen,
			"max_data_len": fn.MaxDataLen,
		}
	}
	return result
}
