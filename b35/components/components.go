package components

type Position struct {
	X, Y float64
}

type Health struct {
	Current, Max int
}

type Inventory struct {
	Items map[string]int
}

type Player struct {
	Name string
}

type EventPhase int

const (
	EventPhaseUndefined EventPhase = iota
	EventPhaseWarning
	EventPhaseActive
	EventPhaseEnding
	EventPhaseEnded
)

func (p EventPhase) String() string {
	switch p {
	case EventPhaseWarning:
		return "预警阶段"
	case EventPhaseActive:
		return "开始阶段"
	case EventPhaseEnding:
		return "结束阶段"
	case EventPhaseEnded:
		return "已结束"
	default:
		return "未定义"
	}
}

type WorldEvent struct {
	Type          string
	Radius        float64
	TotalDuration int
	CurrentPhase  EventPhase
	WarningTime   float64
	ActiveTime    float64
	EndingTime    float64
	PhaseStart    float64
}

type Monster struct {
	EventID uint64
	Power   int
}
