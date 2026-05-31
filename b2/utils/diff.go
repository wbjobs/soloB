package utils

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

type DiffItem struct {
	Field    string      `json:"field"`
	OldValue interface{} `json:"old_value"`
	NewValue interface{} `json:"new_value"`
}

func CalculateDiff(oldObj, newObj interface{}) ([]DiffItem, error) {
	oldVal := reflect.ValueOf(oldObj)
	newVal := reflect.ValueOf(newObj)

	if oldVal.Kind() == reflect.Ptr {
		oldVal = oldVal.Elem()
	}
	if newVal.Kind() == reflect.Ptr {
		newVal = newVal.Elem()
	}

	if oldVal.Kind() != reflect.Struct || newVal.Kind() != reflect.Struct {
		return nil, fmt.Errorf("both objects must be structs")
	}

	if oldVal.Type() != newVal.Type() {
		return nil, fmt.Errorf("both objects must be of the same type")
	}

	var diffs []DiffItem
	typ := oldVal.Type()

	for i := 0; i < oldVal.NumField(); i++ {
		oldField := oldVal.Field(i)
		newField := newVal.Field(i)
		fieldInfo := typ.Field(i)

		if !fieldInfo.IsExported() {
			continue
		}

		tag := fieldInfo.Tag.Get("json")
		if tag == "" {
			continue
		}
		jsonField := strings.Split(tag, ",")[0]
		if jsonField == "-" || jsonField == "" {
			continue
		}

		if !reflect.DeepEqual(oldField.Interface(), newField.Interface()) {
			diffs = append(diffs, DiffItem{
				Field:    jsonField,
				OldValue: oldField.Interface(),
				NewValue: newField.Interface(),
			})
		}
	}

	return diffs, nil
}

func ToJSON(obj interface{}) string {
	if obj == nil {
		return ""
	}
	data, err := json.Marshal(obj)
	if err != nil {
		return ""
	}
	return string(data)
}

func DiffToJSON(diffs []DiffItem) string {
	data, err := json.Marshal(diffs)
	if err != nil {
		return "[]"
	}
	return string(data)
}
