package spatial

import (
	"game-server/components"
	"math"

	"github.com/mlange-42/arche/ecs"
)

type EntityWithPosition struct {
	Entity   ecs.Entity
	Position components.Position
}

type Grid struct {
	cellSize    float64
	worldBounds [2]float64
	gridWidth   int
	gridHeight  int
	cells       map[int][]EntityWithPosition
}

func NewGrid(cellSize float64, worldBounds [2]float64) *Grid {
	gw := int(math.Ceil(worldBounds[0] / cellSize))
	gh := int(math.Ceil(worldBounds[1] / cellSize))

	return &Grid{
		cellSize:    cellSize,
		worldBounds: worldBounds,
		gridWidth:   gw,
		gridHeight:  gh,
		cells:       make(map[int][]EntityWithPosition),
	}
}

func (g *Grid) Clear() {
	for k := range g.cells {
		delete(g.cells, k)
	}
}

func (g *Grid) Insert(entity ecs.Entity, pos components.Position) {
	cellX := int(pos.X / g.cellSize)
	cellY := int(pos.Y / g.cellSize)

	if cellX < 0 || cellX >= g.gridWidth || cellY < 0 || cellY >= g.gridHeight {
		return
	}

	cellKey := cellX*g.gridHeight + cellY
	ep := EntityWithPosition{
		Entity:   entity,
		Position: pos,
	}
	g.cells[cellKey] = append(g.cells[cellKey], ep)
}

func (g *Grid) QueryRadius(center components.Position, radius float64) []EntityWithPosition {
	var results []EntityWithPosition

	minX := int(math.Floor((center.X - radius) / g.cellSize))
	maxX := int(math.Ceil((center.X + radius) / g.cellSize))
	minY := int(math.Floor((center.Y - radius) / g.cellSize))
	maxY := int(math.Ceil((center.Y + radius) / g.cellSize))

	minX = max(0, minX)
	maxX = min(g.gridWidth-1, maxX)
	minY = max(0, minY)
	maxY = min(g.gridHeight-1, maxY)

	radiusSq := radius * radius

	for cx := minX; cx <= maxX; cx++ {
		for cy := minY; cy <= maxY; cy++ {
			cellKey := cx*g.gridHeight + cy
			if entities, exists := g.cells[cellKey]; exists {
				for _, ep := range entities {
					dx := ep.Position.X - center.X
					dy := ep.Position.Y - center.Y
					distSq := dx*dx + dy*dy
					if distSq <= radiusSq {
						results = append(results, ep)
					}
				}
			}
		}
	}

	return results
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
