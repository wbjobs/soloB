package balancer

import (
	"hash/crc32"
	"sort"
	"strconv"
	"sync"
)

type HashFunc func(data []byte) uint32

type ConsistentHash struct {
	hashFunc HashFunc
	replicas int
	ring     []uint32
	hashMap  map[uint32]string
	mu       sync.RWMutex
}

func NewConsistentHash(replicas int, fn HashFunc) *ConsistentHash {
	if fn == nil {
		fn = crc32.ChecksumIEEE
	}
	return &ConsistentHash{
		replicas: replicas,
		hashFunc: fn,
		hashMap:  make(map[uint32]string),
	}
}

func (ch *ConsistentHash) Add(nodes ...string) {
	ch.mu.Lock()
	defer ch.mu.Unlock()

	for _, node := range nodes {
		for i := 0; i < ch.replicas; i++ {
			hash := ch.hashFunc([]byte(node + strconv.Itoa(i)))
			ch.ring = append(ch.ring, hash)
			ch.hashMap[hash] = node
		}
	}
	sort.Slice(ch.ring, func(i, j int) bool {
		return ch.ring[i] < ch.ring[j]
	})
}

func (ch *ConsistentHash) Remove(node string) {
	ch.mu.Lock()
	defer ch.mu.Unlock()

	keysToRemove := make([]uint32, 0)
	for i := 0; i < ch.replicas; i++ {
		hash := ch.hashFunc([]byte(node + strconv.Itoa(i)))
		keysToRemove = append(keysToRemove, hash)
		delete(ch.hashMap, hash)
	}

	newRing := make([]uint32, 0, len(ch.ring)-len(keysToRemove))
	for _, h := range ch.ring {
		found := false
		for _, kr := range keysToRemove {
			if h == kr {
				found = true
				break
			}
		}
		if !found {
			newRing = append(newRing, h)
		}
	}
	ch.ring = newRing
}

func (ch *ConsistentHash) Get(key string) string {
	ch.mu.RLock()
	defer ch.mu.RUnlock()

	if len(ch.ring) == 0 {
		return ""
	}

	hash := ch.hashFunc([]byte(key))
	idx := sort.Search(len(ch.ring), func(i int) bool {
		return ch.ring[i] >= hash
	})

	if idx == len(ch.ring) {
		idx = 0
	}

	return ch.hashMap[ch.ring[idx]]
}

func (ch *ConsistentHash) GetNodes() []string {
	ch.mu.RLock()
	defer ch.mu.RUnlock()

	nodes := make(map[string]struct{})
	for _, node := range ch.hashMap {
		nodes[node] = struct{}{}
	}

	result := make([]string, 0, len(nodes))
	for node := range nodes {
		result = append(result, node)
	}
	return result
}

type TaskBalancer struct {
	consistentHash *ConsistentHash
	executors      map[string]int
	executorMu     sync.RWMutex
	maxLoad        int
}

func NewTaskBalancer(replicas int, maxLoad int) *TaskBalancer {
	return &TaskBalancer{
		consistentHash: NewConsistentHash(replicas, nil),
		executors:      make(map[string]int),
		maxLoad:        maxLoad,
	}
}

func (tb *TaskBalancer) RegisterExecutor(id string) {
	tb.executorMu.Lock()
	defer tb.executorMu.Unlock()

	tb.executors[id] = 0
	tb.consistentHash.Add(id)
}

func (tb *TaskBalancer) UnregisterExecutor(id string) {
	tb.executorMu.Lock()
	defer tb.executorMu.Unlock()

	delete(tb.executors, id)
	tb.consistentHash.Remove(id)
}

func (tb *TaskBalancer) UpdateLoad(id string, load int) {
	tb.executorMu.Lock()
	defer tb.executorMu.Unlock()
	tb.executors[id] = load
}

func (tb *TaskBalancer) Assign(taskID string) (string, error) {
	tb.executorMu.RLock()
	defer tb.executorMu.RUnlock()

	if len(tb.executors) == 0 {
		return "", nil
	}

	primary := tb.consistentHash.Get(taskID)
	if load, ok := tb.executors[primary]; ok && load < tb.maxLoad {
		return primary, nil
	}

	nodes := tb.consistentHash.GetNodes()
	for _, node := range nodes {
		if tb.executors[node] < tb.maxLoad {
			return node, nil
		}
	}

	return primary, nil
}

func (tb *TaskBalancer) Reassign(taskID string, failedExecutor string) string {
	tb.executorMu.RLock()
	defer tb.executorMu.RUnlock()

	nodes := tb.consistentHash.GetNodes()
	for _, node := range nodes {
		if node != failedExecutor && tb.executors[node] < tb.maxLoad {
			return node
		}
	}

	return ""
}

func (tb *TaskBalancer) GetExecutors() map[string]int {
	tb.executorMu.RLock()
	defer tb.executorMu.RUnlock()

	result := make(map[string]int)
	for k, v := range tb.executors {
		result[k] = v
	}
	return result
}
