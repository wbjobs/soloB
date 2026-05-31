package events

type Event struct {
	Type    string
	Data    interface{}
	Targets []TargetInfo
}

type TargetInfo struct {
	EntityID uint64
	Message  string
}

type EventHandler func(Event)

type EventBus struct {
	handlers map[string][]EventHandler
}

func NewEventBus() *EventBus {
	return &EventBus{
		handlers: make(map[string][]EventHandler),
	}
}

func (eb *EventBus) Subscribe(eventType string, handler EventHandler) {
	eb.handlers[eventType] = append(eb.handlers[eventType], handler)
}

func (eb *EventBus) Publish(event Event) {
	if handlers, exists := eb.handlers[event.Type]; exists {
		for _, handler := range handlers {
			handler(event)
		}
	}
}
