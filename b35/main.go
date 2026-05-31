package main

import (
	"fmt"
	"game-server/components"
	"game-server/events"
	"game-server/systems"
	"log"
	"math/rand"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mlange-42/arche/ecs"
)

func main() {
	rand.Seed(time.Now().UnixNano())

	world := ecs.NewWorld()
	eventBus := events.NewEventBus()

	setupEventHandlers(eventBus)

	movementSystem := systems.NewMovementSystem(&world)
	eventSystem := systems.NewEventSystem(&world, eventBus, 5*time.Second)

	createTestEntities(&world)

	fmt.Println("游戏服务器已启动！")
	fmt.Println("按 Ctrl+C 停止服务器")

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	frameCount := 0
	for {
		select {
		case <-ticker.C:
			frameCount++
			movementSystem.Update(&world)
			eventSystem.Update()

			if frameCount%600 == 0 {
				log.Printf("当前活跃事件数: %d", eventSystem.GetActiveEventsCount())
			}
		case <-stop:
			fmt.Println("\n服务器正在停止...")
			return
		}
	}
}

func setupEventHandlers(bus *events.EventBus) {
	bus.Subscribe("event_warning", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		if len(e.Targets) > 0 {
			log.Printf("[预警通知] %s 事件预警！通知了 %d 个玩家",
				data["event_type"], len(e.Targets))
			for _, target := range e.Targets {
				log.Printf("  - 玩家ID: %d | %s", target.EntityID, target.Message)
			}
		} else {
			log.Printf("[预警] %s 事件将发生，但附近暂无玩家", data["event_type"])
		}
	})

	bus.Subscribe("event_started", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		if len(e.Targets) > 0 {
			log.Printf("[开始] %s 事件开始！通知了 %d 个玩家",
				data["event_type"], len(e.Targets))
		}
	})

	bus.Subscribe("event_ending", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		log.Printf("[结算] %s 事件即将结束，正在计算奖励...", data["event_type"])
	})

	bus.Subscribe("event_phase_changed", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		log.Printf("[阶段变更] %s -> %s", 
			data["event_type"], data["new_phase"])
	})

	bus.Subscribe("monsters_spawned", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		log.Printf("[怪物生成] 事件ID: %d | 怪物数量: %d | 位置: (%.2f, %.2f)",
			data["event_id"],
			data["monster_count"],
			data["position"].(components.Position).X,
			data["position"].(components.Position).Y)
	})

	bus.Subscribe("player_entered_event_range", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		log.Printf("[玩家进入范围] 事件类型: %s | 影响玩家数: %d",
			data["event_type"], len(e.Targets))
		for _, target := range e.Targets {
			log.Printf("  - 玩家ID: %d | %s", target.EntityID, target.Message)
		}
	})

	bus.Subscribe("reward_given", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		log.Printf("[奖励发放] %s 事件 | 发放给 %d 个玩家",
			data["event_type"], len(e.Targets))
		for _, target := range e.Targets {
			log.Printf("  - 玩家ID: %d | %s", target.EntityID, target.Message)
		}
	})

	bus.Subscribe("world_event_ended", func(e events.Event) {
		data := e.Data.(map[string]interface{})
		log.Printf("[事件结束] %s 事件已完全结束", data["event_type"])
	})
}

func createTestEntities(world *ecs.World) {
	posID := ecs.ComponentID[components.Position](world)
	healthID := ecs.ComponentID[components.Health](world)
	inventoryID := ecs.ComponentID[components.Inventory](world)
	playerID := ecs.ComponentID[components.Player](world)

	playerCount := 100
	playerNames := make([]string, playerCount)
	for i := 0; i < playerCount; i++ {
		playerNames[i] = fmt.Sprintf("Player%d", i+1)
	}

	for _, name := range playerNames {
		entity := world.NewEntity(posID, healthID, inventoryID, playerID)

		pos := (*components.Position)(world.Get(entity, posID))
		*pos = components.Position{
			X: rand.Float64() * 100,
			Y: rand.Float64() * 100,
		}

		health := (*components.Health)(world.Get(entity, healthID))
		*health = components.Health{
			Current: 100,
			Max:     100,
		}

		inventory := (*components.Inventory)(world.Get(entity, inventoryID))
		*inventory = components.Inventory{
			Items: make(map[string]int),
		}

		player := (*components.Player)(world.Get(entity, playerID))
		*player = components.Player{
			Name: name,
		}
	}

	log.Printf("已创建 %d 个测试玩家实体", playerCount)
}
