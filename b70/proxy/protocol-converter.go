package proxy

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
)

type ProtocolType string

const (
	ProtocolGeneric ProtocolType = "generic"
	ProtocolModbus  ProtocolType = "modbus"
)

type BinaryData struct {
	Protocol ProtocolType `json:"protocol"`
	Length   int          `json:"length"`
	Data     string       `json:"data"`
	Fields   interface{}  `json:"fields,omitempty"`
}

type ModbusFields struct {
	TransactionID uint16 `json:"transaction_id"`
	ProtocolID    uint16 `json:"protocol_id"`
	Length        uint16 `json:"length"`
	UnitID        uint8  `json:"unit_id"`
	FunctionCode  uint8  `json:"function_code"`
	Data          []byte `json:"data"`
}

type ProtocolConverter struct {
	protocol ProtocolType
}

func NewProtocolConverter(protocol ProtocolType) *ProtocolConverter {
	return &ProtocolConverter{
		protocol: protocol,
	}
}

func (c *ProtocolConverter) BinaryToJSON(data []byte) ([]byte, error) {
	binaryData := BinaryData{
		Protocol: c.protocol,
		Length:   len(data),
		Data:     hex.EncodeToString(data),
	}

	if c.protocol == ProtocolModbus && len(data) >= 8 {
		fields, err := parseModbus(data)
		if err == nil {
			binaryData.Fields = fields
		}
	}

	return json.Marshal(binaryData)
}

func (c *ProtocolConverter) JSONToBinary(jsonData []byte) ([]byte, error) {
	var binaryData BinaryData
	if err := json.Unmarshal(jsonData, &binaryData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}

	data, err := hex.DecodeString(binaryData.Data)
	if err != nil {
		return nil, fmt.Errorf("failed to decode hex data: %w", err)
	}

	return data, nil
}

func parseModbus(data []byte) (*ModbusFields, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("modbus data too short, minimum 8 bytes required")
	}

	return &ModbusFields{
		TransactionID: uint16(data[0])<<8 | uint16(data[1]),
		ProtocolID:    uint16(data[2])<<8 | uint16(data[3]),
		Length:        uint16(data[4])<<8 | uint16(data[5]),
		UnitID:        data[6],
		FunctionCode:  data[7],
		Data:          data[8:],
	}, nil
}
