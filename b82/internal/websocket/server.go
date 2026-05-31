package websocket

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"iiothub/internal/prediction"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	ID         string
	Conn       *websocket.Conn
	Send       chan []byte
	Subscribed map[string]bool
	mu         sync.RWMutex
}

type WebSocketServer struct {
	clients    map[string]*Client
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
	predictor  *prediction.LoadPredictor
}

type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type SubscribeMessage struct {
	MeterID string `json:"meter_id"`
}

type PredictionUpdate struct {
	Type     string                       `json:"type"`
	MeterID  string                       `json:"meter_id"`
	Time     time.Time                    `json:"time"`
	Payload  *prediction.PredictionResult `json:"payload"`
}

func NewWebSocketServer(predictor *prediction.LoadPredictor) *WebSocketServer {
	return &WebSocketServer{
		clients:    make(map[string]*Client),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		predictor:  predictor,
	}
}

func (s *WebSocketServer) Start() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case client := <-s.register:
			s.mu.Lock()
			s.clients[client.ID] = client
			s.mu.Unlock()
			log.Printf("Client %s connected", client.ID)

		case client := <-s.unregister:
			s.mu.Lock()
			if _, ok := s.clients[client.ID]; ok {
				delete(s.clients, client.ID)
				close(client.Send)
				log.Printf("Client %s disconnected", client.ID)
			}
			s.mu.Unlock()

		case message := <-s.broadcast:
			s.mu.RLock()
			for _, client := range s.clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(s.clients, client.ID)
				}
			}
			s.mu.RUnlock()
		}
	}
}

func (s *WebSocketServer) HandleConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}

	clientID := r.URL.Query().Get("client_id")
	if clientID == "" {
		clientID = "client_" + time.Now().Format("150405.000000")
	}

	client := &Client{
		ID:         clientID,
		Conn:       conn,
		Send:       make(chan []byte, 256),
		Subscribed: make(map[string]bool),
	}

	s.register <- client

	go client.ReadPump(s)
	go client.WritePump()
}

func (c *Client) ReadPump(server *WebSocketServer) {
	defer func() {
		server.unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(512)
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		c.HandleMessage(server, &msg)
	}
}

func (c *Client) HandleMessage(server *WebSocketServer, msg *Message) {
	switch msg.Type {
	case "subscribe":
		payloadBytes, _ := json.Marshal(msg.Payload)
		var subMsg SubscribeMessage
		if err := json.Unmarshal(payloadBytes, &subMsg); err == nil {
			c.mu.Lock()
			c.Subscribed[subMsg.MeterID] = true
			c.mu.Unlock()
			log.Printf("Client %s subscribed to meter %s", c.ID, subMsg.MeterID)
		}

	case "unsubscribe":
		payloadBytes, _ := json.Marshal(msg.Payload)
		var subMsg SubscribeMessage
		if err := json.Unmarshal(payloadBytes, &subMsg); err == nil {
			c.mu.Lock()
			delete(c.Subscribed, subMsg.MeterID)
			c.mu.Unlock()
			log.Printf("Client %s unsubscribed from meter %s", c.ID, subMsg.MeterID)
		}

	case "ping":
		response := Message{
			Type:    "pong",
			Payload: time.Now().Unix(),
		}
		if data, err := json.Marshal(response); err == nil {
			c.Send <- data
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("Write error: %v", err)
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (s *WebSocketServer) BroadcastPrediction(meterID string, result *prediction.PredictionResult) {
	if result == nil {
		return
	}

	update := PredictionUpdate{
		Type:    "prediction_update",
		MeterID: meterID,
		Time:    time.Now(),
		Payload: result,
	}

	data, err := json.Marshal(update)
	if err != nil {
		log.Printf("Failed to marshal prediction update: %v", err)
		return
	}

	s.mu.RLock()
	for _, client := range s.clients {
		client.mu.RLock()
		subscribed := client.Subscribed[meterID]
		client.mu.RUnlock()

		if subscribed {
			select {
			case client.Send <- data:
			default:
				close(client.Send)
				delete(s.clients, client.ID)
			}
		}
	}
	s.mu.RUnlock()
}

func (s *WebSocketServer) GetConnectedClients() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.clients)
}

func (s *WebSocketServer) GetSubscribers(meterID string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var subscribers []string
	for _, client := range s.clients {
		client.mu.RLock()
		if client.Subscribed[meterID] {
			subscribers = append(subscribers, client.ID)
		}
		client.mu.RUnlock()
	}
	return subscribers
}
