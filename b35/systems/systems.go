package systems

import (
	"fmt"
	"game-server/components"
	"game-server/events"
	"game-server/spatial"
	"math"
	"math/rand"
	"time"

	"github.com/mlange-42/arche/ecs"
	"github.com/mlange-42/arche/generic"
)

type EventInstance struct {
	Entity        ecs.Entity
	Position      components.Position
	Event         components.WorldEvent
	Notified      map[uint64]bool
	CreatedAt     time.Time
	LastUpdate    time.Time
	Monsters      []ecs.Entity
	RewardGiven   map[uint64]bool
}

type MovementSystem struct {
	filter *generic.Filter1[components.Position]
}

func NewMovementSystem(world *ecs.World) *MovementSystem {
	return &MovementSystem{
		filter: generic.NewFilter1[components.Position](),
	}
}

func (s *MovementSystem) Update(world *ecs.World) {
	query := s.filter.Query(world)
	for query.Next() {
		pos := query.Get()
		pos.X += (rand.Float64() - 0.5) * 0.1
		pos.Y += (rand.Float64() - 0.5) * 0.1
	}
}

type EventSystem struct {
	eventBus       *events.EventBus
	world          *ecs.World
	lastEventTime  time.Time
	eventInterval  time.Duration
	playerFilter   *generic.Filter2[components.Player, components.Position]
	eventFilter    *generic.Filter2[components.Position, components.WorldEvent]
	posID          ecs.ID
	eventID        ecs.ID
	healthID       ecs.ID
	monsterID      ecs.ID
	inventoryID    ecs.ID
	eventTypes     []string
	activeEvents   map[uint64]*EventInstance
	playerGrid     *spatial.Grid
	frameCount     int
	updateInterval int
}

func NewEventSystem(world *ecs.World, bus *events.EventBus, interval time.Duration) *EventSystem {
	posID := ecs.ComponentID[components.Position](world)
	eventID := ecs.ComponentID[components.WorldEvent](world)
	healthID := ecs.ComponentID[components.Health](world)
	monsterID := ecs.ComponentID[components.Monster](world)
	inventoryID := ecs.ComponentID[components.Inventory](world)

	return &EventSystem{
		eventBus:       bus,
		world:          world,
		lastEventTime:  time.Now(),
		eventInterval:  interval,
		playerFilter:   generic.NewFilter2[components.Player, components.Position](),
		eventFilter:    generic.NewFilter2[components.Position, components.WorldEvent](),
		posID:          posID,
		eventID:        eventID,
		healthID:       healthID,
		monsterID:      monsterID,
		inventoryID:    inventoryID,
		eventTypes: []string{
			"矿脉刷新",
			"怪物入侵",
			"宝箱出现",
			"神秘商人到访",
		},
		activeEvents:   make(map[uint64]*EventInstance),
		playerGrid:     spatial.NewGrid(25.0, [2]float64{100.0, 100.0}),
		updateInterval: 3,
	}
}

func (s *EventSystem) Update() {
	s.frameCount++

	now := time.Now()

	if now.Sub(s.lastEventTime) >= s.eventInterval {
		s.createWorldEvent()
		s.lastEventTime = now
	}

	if s.frameCount%s.updateInterval == 0 {
		s.updatePlayerGrid()
		s.processAllEvents()
	}
}

func (s *EventSystem) updatePlayerGrid() {
	s.playerGrid.Clear()

	query := s.playerFilter.Query(s.world)
	for query.Next() {
		_, pos := query.Get()
		entity := query.Entity()
		s.playerGrid.Insert(entity, *pos)
	}
}

func (s *EventSystem) createWorldEvent() {
	eventPos := components.Position{
		X: rand.Float64() * 100,
		Y: rand.Float64() * 100,
	}

	eventType := s.eventTypes[rand.Intn(len(s.eventTypes))]
	eventEntity := s.world.NewEntity(s.posID, s.eventID)

	pos := (*components.Position)(s.world.Get(eventEntity, s.posID))
	*pos = eventPos

	totalDuration := 60
	warningTime := 10.0
	activeTime := 40.0
	endingTime := 10.0

	if eventType == "怪物入侵" {
		totalDuration = 90
		warningTime = 15.0
		activeTime = 60.0
		endingTime = 15.0
	}

	eventComp := (*components.WorldEvent)(s.world.Get(eventEntity, s.eventID))
	*eventComp = components.WorldEvent{
		Type:          eventType,
		Radius:        20.0,
		TotalDuration: totalDuration,
		CurrentPhase:  components.EventPhaseWarning,
		WarningTime:   warningTime,
		ActiveTime:    activeTime,
		EndingTime:    endingTime,
		PhaseStart:    0,
	}

	eventInstance := &EventInstance{
		Entity:      eventEntity,
		Position:    eventPos,
		Event:       *eventComp,
		Notified:    make(map[uint64]bool),
		CreatedAt:   time.Now(),
		LastUpdate:  time.Now(),
		Monsters:    []ecs.Entity{},
		RewardGiven: make(map[uint64]bool),
	}

	entityID := uint64(eventEntity)
	s.activeEvents[entityID] = eventInstance

	s.enterPhase(eventInstance, components.EventPhaseWarning, 0)
}

func (s *EventSystem) enterPhase(event *EventInstance, phase components.EventPhase, elapsed float64) {
	event.Event.CurrentPhase = phase
	event.Event.PhaseStart = elapsed

	eventEntity := ecs.Entity(uint64(event.Entity))
	if s.world.Alive(eventEntity) {
		eventComp := (*components.WorldEvent)(s.world.Get(eventEntity, s.eventID))
		*eventComp = event.Event
	}

	switch phase {
	case components.EventPhaseWarning:
		s.handleWarningPhaseStart(event)
	case components.EventPhaseActive:
		s.handleActivePhaseStart(event)
	case components.EventPhaseEnding:
		s.handleEndingPhaseStart(event)
	case components.EventPhaseEnded:
		s.handleEndedPhase(event)
	}
}

func (s *EventSystem) handleWarningPhaseStart(event *EventInstance) {
	eventType := event.Event.Type
	message := fmt.Sprintf("【预警】%s 将在 %.0f 秒后发生！位置已标记！", 
		eventType, event.Event.WarningTime)

	s.notifyNearbyPlayers(event, message, "event_warning")

	s.eventBus.Publish(events.Event{
		Type: "event_phase_changed",
		Data: map[string]interface{}{
			"event_type":  eventType,
			"new_phase":   "预警阶段",
			"position":    event.Position,
			"radius":      event.Event.Radius,
			"next_phase":  "开始阶段",
			"wait_seconds": event.Event.WarningTime,
		},
		Targets: nil,
	})
}

func (s *EventSystem) handleActivePhaseStart(event *EventInstance) {
	eventType := event.Event.Type
	
	if eventType == "怪物入侵" {
		s.spawnMonsters(event)
		message := "【警报】怪物入侵开始！准备战斗！"
		s.notifyNearbyPlayers(event, message, "event_started")
	} else {
		message := fmt.Sprintf("【开始】%s 已经开始！", eventType)
		s.notifyNearbyPlayers(event, message, "event_started")
	}

	s.eventBus.Publish(events.Event{
		Type: "event_phase_changed",
		Data: map[string]interface{}{
			"event_type":  eventType,
			"new_phase":   "开始阶段",
			"position":    event.Position,
			"duration":    event.Event.ActiveTime,
		},
		Targets: nil,
	})
}

func (s *EventSystem) spawnMonsters(event *EventInstance) {
	monsterCount := 5 + rand.Intn(5)
	eventID := uint64(event.Entity)

	for i := 0; i < monsterCount; i++ {
		angle := rand.Float64() * 2 * math.Pi
		dist := rand.Float64() * event.Event.Radius * 0.8
		
		monsterPos := components.Position{
			X: event.Position.X + math.Cos(angle)*dist,
			Y: event.Position.Y + math.Sin(angle)*dist,
		}

		monsterEntity := s.world.NewEntity(s.posID, s.healthID, s.monsterID)

		pos := (*components.Position)(s.world.Get(monsterEntity, s.posID))
		*pos = monsterPos

		health := (*components.Health)(s.world.Get(monsterEntity, s.healthID))
		*health = components.Health{
			Current: 100,
			Max:     100,
		}

		monster := (*components.Monster)(s.world.Get(monsterEntity, s.monsterID))
		*monster = components.Monster{
			EventID: eventID,
			Power:   10 + rand.Intn(20),
		}

		event.Monsters = append(event.Monsters, monsterEntity)
	}

	s.eventBus.Publish(events.Event{
		Type: "monsters_spawned",
		Data: map[string]interface{}{
			"event_id":      eventID,
			"monster_count": monsterCount,
			"position":      event.Position,
		},
		Targets: nil,
	})
}

func (s *EventSystem) handleEndingPhaseStart(event *EventInstance) {
	eventType := event.Event.Type
	message := fmt.Sprintf("【结算】%s 即将结束，正在计算奖励...", eventType)
	s.notifyNearbyPlayers(event, message, "event_ending")

	s.eventBus.Publish(events.Event{
		Type: "event_phase_changed",
		Data: map[string]interface{}{
			"event_type":  eventType,
			"new_phase":   "结束阶段",
			"position":    event.Position,
		},
		Targets: nil,
	})
}

func (s *EventSystem) handleEndedPhase(event *EventInstance) {
	eventType := event.Event.Type

	s.giveRewards(event)
	s.removeMonsters(event)

	s.eventBus.Publish(events.Event{
		Type: "world_event_ended",
		Data: map[string]interface{}{
			"event_type": eventType,
			"position":   event.Position,
		},
		Targets: nil,
	})

	entityID := uint64(event.Entity)
	entity := ecs.Entity(entityID)
	if s.world.Alive(entity) {
		s.world.RemoveEntity(entity)
	}
	delete(s.activeEvents, entityID)
}

func (s *EventSystem) giveRewards(event *EventInstance) {
	nearbyPlayers := s.playerGrid.QueryRadius(event.Position, event.Event.Radius)
	
	if len(nearbyPlayers) == 0 {
		return
	}

	var rewardedPlayers []events.TargetInfo
	eventType := event.Event.Type

	for _, ep := range nearbyPlayers {
		playerID := uint64(ep.Entity)
		if !event.RewardGiven[playerID] {
			event.RewardGiven[playerID] = true
			
			if s.world.Alive(ep.Entity) {
				inventory := (*components.Inventory)(s.world.Get(ep.Entity, s.inventoryID))
				if inventory != nil {
					rewardItems := s.getRewardItems(eventType)
					for item, amount := range rewardItems {
						inventory.Items[item] += amount
					}
				}
			}

			rewardedPlayers = append(rewardedPlayers, events.TargetInfo{
				EntityID: playerID,
				Message:  fmt.Sprintf("获得奖励！%s", formatRewards(s.getRewardItems(eventType))),
			})
		}
	}

	if len(rewardedPlayers) > 0 {
		s.eventBus.Publish(events.Event{
			Type: "reward_given",
			Data: map[string]interface{}{
				"event_type": eventType,
				"position":   event.Position,
			},
			Targets: rewardedPlayers,
		})
	}
}

func (s *EventSystem) getRewardItems(eventType string) map[string]int {
	switch eventType {
	case "矿脉刷新":
		return map[string]int{"铁矿": 10, "金矿": 5}
	case "怪物入侵":
		return map[string]int{"金币": 100, "经验值": 200, "稀有材料": 1}
	case "宝箱出现":
		return map[string]int{"金币": 50, "随机道具": 3}
	case "神秘商人到访":
		return map[string]int{"折扣券": 1, "稀有商品": 2}
	default:
		return map[string]int{"金币": 10}
	}
}

func formatRewards(items map[string]int) string {
	result := ""
	for item, amount := range items {
		result += fmt.Sprintf("%s x%d ", item, amount)
	}
	return result
}

func (s *EventSystem) removeMonsters(event *EventInstance) {
	for _, monsterEntity := range event.Monsters {
		if s.world.Alive(monsterEntity) {
			s.world.RemoveEntity(monsterEntity)
		}
	}
	event.Monsters = []ecs.Entity{}
}

func (s *EventSystem) notifyNearbyPlayers(event *EventInstance, message string, eventType string) {
	nearbyPlayers := s.playerGrid.QueryRadius(event.Position, event.Event.Radius)

	if len(nearbyPlayers) == 0 {
		return
	}

	var targets []events.TargetInfo
	for _, ep := range nearbyPlayers {
		playerID := uint64(ep.Entity)
		targets = append(targets, events.TargetInfo{
			EntityID: playerID,
			Message:  message,
		})
	}

	if len(targets) > 0 {
		s.eventBus.Publish(events.Event{
			Type: eventType,
			Data: map[string]interface{}{
				"event_type": event.Event.Type,
				"position":   event.Position,
				"radius":     event.Event.Radius,
			},
			Targets: targets,
		})
	}
}

func (s *EventSystem) processAllEvents() {
	now := time.Now()

	for _, event := range s.activeEvents {
		elapsed := now.Sub(event.CreatedAt).Seconds()
		s.updateEventPhase(event, elapsed)

		if event.Event.CurrentPhase == components.EventPhaseActive {
			s.checkForNewPlayers(event)
		}

		event.LastUpdate = now
	}
}

func (s *EventSystem) updateEventPhase(event *EventInstance, elapsed float64) {
	currentPhase := event.Event.CurrentPhase
	phaseElapsed := elapsed - event.Event.PhaseStart

	switch currentPhase {
	case components.EventPhaseWarning:
		if phaseElapsed >= event.Event.WarningTime {
			s.enterPhase(event, components.EventPhaseActive, elapsed)
		}

	case components.EventPhaseActive:
		if phaseElapsed >= event.Event.ActiveTime {
			s.enterPhase(event, components.EventPhaseEnding, elapsed)
		}

	case components.EventPhaseEnding:
		if phaseElapsed >= event.Event.EndingTime {
			s.enterPhase(event, components.EventPhaseEnded, elapsed)
		}
	}
}

func (s *EventSystem) checkForNewPlayers(event *EventInstance) {
	nearbyPlayers := s.playerGrid.QueryRadius(event.Position, event.Event.Radius)

	var newTargets []events.TargetInfo
	for _, ep := range nearbyPlayers {
		playerID := uint64(ep.Entity)
		if !event.Notified[playerID] {
			event.Notified[playerID] = true
			newTargets = append(newTargets, events.TargetInfo{
				EntityID: playerID,
				Message:  fmt.Sprintf("注意！您进入了%s事件范围！", event.Event.Type),
			})
		}
	}

	if len(newTargets) > 0 {
		s.eventBus.Publish(events.Event{
			Type: "player_entered_event_range",
			Data: map[string]interface{}{
				"event_type": event.Event.Type,
				"position":   event.Position,
			},
			Targets: newTargets,
		})
	}
}

func (s *EventSystem) GetActiveEventsCount() int {
	return len(s.activeEvents)
}
