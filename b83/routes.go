package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"golang.org/x/crypto/bcrypt"

	"web-ssh-bastion/cmd"
	"web-ssh-bastion/models"
	"web-ssh-bastion/ssh"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func setupRoutes(r *gin.Engine) {
	api := r.Group("/api")
	{
		api.POST("/auth/login", login)
		api.POST("/auth/register", register)

		auth := api.Group("")
		auth.Use(AuthMiddleware())
		{
			auth.GET("/servers", getServers)
			auth.POST("/servers", createServer)
			auth.DELETE("/servers/:id", deleteServer)

			auth.GET("/sessions", getSessions)
			auth.GET("/sessions/:id", getSession)
			auth.GET("/sessions/:id/frames", getSessionFrames)
			auth.GET("/sessions/:id/commands", getSessionCommands)

			auth.GET("/alerts", getAlerts)
			auth.GET("/commands/suggestions", getCommandSuggestions)
			auth.GET("/commands/top", getTopCommands)
		}
	}

	r.GET("/ws/ssh", handleSSHWebSocket)
	r.GET("/ws/playback", handlePlaybackWebSocket)
	r.GET("/ws/autocomplete", handleAutocompleteWebSocket)
}

func getCommandSuggestions(c *gin.Context) {
	userID := c.Get("user_id").(primitive.ObjectID)
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	input := c.Query("input")
	cursorPos, _ := strconv.Atoi(c.DefaultQuery("cursor_pos", strconv.Itoa(len(input))))

	suggestions := cmd.GetSuggestions(context.Background(), mongoDB, userID.Hex(), tenantID.Hex(), input, cursorPos)
	c.JSON(http.StatusOK, gin.H{"suggestions": suggestions})
}

func getTopCommands(c *gin.Context) {
	userID := c.Get("user_id").(primitive.ObjectID)
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "50"), 10, 64)

	commands, err := cmd.GetTopCommands(context.Background(), mongoDB, userID.Hex(), tenantID.Hex(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"commands": commands})
}

func handleAutocompleteWebSocket(c *gin.Context) {
	userID := c.Query("user_id")
	tenantID := c.Query("tenant_id")

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var req struct {
			Input    string `json:"input"`
			CursorPos int   `json:"cursor_pos"`
		}
		if err := json.Unmarshal(msg, &req); err != nil {
			continue
		}

		suggestions := cmd.GetSuggestions(context.Background(), mongoDB, userID, tenantID, req.Input, req.CursorPos)
		
		response, _ := json.Marshal(gin.H{"suggestions": suggestions})
		conn.WriteMessage(websocket.TextMessage, response)
	}
}

func login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	err := mongoDB.Collection("users").FindOne(context.Background(), bson.M{"username": req.Username}).Decode(&user)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":   user.ID.Hex(),
		"tenant_id": user.TenantID.Hex(),
		"username":  user.Username,
		"role":      user.Role,
		"exp":       time.Now().Add(24 * time.Hour).Unix(),
	})

	tokenString, _ := token.SignedString([]byte(os.Getenv("JWT_SECRET")))
	c.JSON(http.StatusOK, gin.H{"token": tokenString, "user": user})
}

func register(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Tenant   string `json:"tenant"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)

	tenant := models.Tenant{
		Name:      req.Tenant,
		CreatedAt: time.Now(),
	}
	tenantResult, _ := mongoDB.Collection("tenants").InsertOne(context.Background(), tenant)
	tenantID := tenantResult.InsertedID.(primitive.ObjectID)

	user := models.User{
		TenantID:  tenantID,
		Username:  req.Username,
		Password:  string(hashedPassword),
		Role:      "admin",
		CreatedAt: time.Now(),
	}
	mongoDB.Collection("users").InsertOne(context.Background(), user)

	c.JSON(http.StatusOK, gin.H{"message": "User registered successfully"})
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		token, err := jwt.Parse(authHeader, func(token *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("JWT_SECRET")), nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		claims := token.Claims.(jwt.MapClaims)
		userID, _ := primitive.ObjectIDFromHex(claims["user_id"].(string))
		tenantID, _ := primitive.ObjectIDFromHex(claims["tenant_id"].(string))

		c.Set("user_id", userID)
		c.Set("tenant_id", tenantID)
		c.Set("username", claims["username"])
		c.Set("role", claims["role"])

		c.Next()
	}
}

func getServers(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	cursor, _ := mongoDB.Collection("servers").Find(context.Background(), bson.M{"tenant_id": tenantID})
	var servers []models.Server
	cursor.All(context.Background(), &servers)
	c.JSON(http.StatusOK, servers)
}

func createServer(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	var server models.Server
	if err := c.ShouldBindJSON(&server); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	server.TenantID = tenantID
	server.CreatedAt = time.Now()
	result, _ := mongoDB.Collection("servers").InsertOne(context.Background(), server)
	server.ID = result.InsertedID.(primitive.ObjectID)
	c.JSON(http.StatusOK, server)
}

func deleteServer(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	id, _ := primitive.ObjectIDFromHex(c.Param("id"))
	mongoDB.Collection("servers").DeleteOne(context.Background(), bson.M{"_id": id, "tenant_id": tenantID})
	c.JSON(http.StatusOK, gin.H{"message": "Server deleted"})
}

func getSessions(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	cursor, _ := mongoDB.Collection("sessions").Find(context.Background(), bson.M{"tenant_id": tenantID})
	var sessions []models.Session
	cursor.All(context.Background(), &sessions)
	c.JSON(http.StatusOK, sessions)
}

func getSession(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	id, _ := primitive.ObjectIDFromHex(c.Param("id"))
	var session models.Session
	mongoDB.Collection("sessions").FindOne(context.Background(), bson.M{"_id": id, "tenant_id": tenantID}).Decode(&session)
	c.JSON(http.StatusOK, session)
}

func getSessionFrames(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	sessionID, _ := primitive.ObjectIDFromHex(c.Param("id"))
	cursor, _ := mongoDB.Collection("session_frames").Find(context.Background(), bson.M{"session_id": sessionID})
	var frames []models.SessionFrame
	cursor.All(context.Background(), &frames)
	c.JSON(http.StatusOK, frames)
}

func getSessionCommands(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	sessionID, _ := primitive.ObjectIDFromHex(c.Param("id"))
	cursor, _ := mongoDB.Collection("command_records").Find(context.Background(), bson.M{"session_id": sessionID, "tenant_id": tenantID})
	var commands []models.CommandRecord
	cursor.All(context.Background(), &commands)
	c.JSON(http.StatusOK, commands)
}

func getAlerts(c *gin.Context) {
	tenantID := c.Get("tenant_id").(primitive.ObjectID)
	cursor, _ := mongoDB.Collection("alerts").Find(context.Background(), bson.M{"tenant_id": tenantID})
	var alerts []models.Alert
	cursor.All(context.Background(), &alerts)
	c.JSON(http.StatusOK, alerts)
}

func handleSSHWebSocket(c *gin.Context) {
	serverID, _ := primitive.ObjectIDFromHex(c.Query("server_id"))
	userID, _ := primitive.ObjectIDFromHex(c.Query("user_id"))
	tenantID, _ := primitive.ObjectIDFromHex(c.Query("tenant_id"))

	var server models.Server
	mongoDB.Collection("servers").FindOne(context.Background(), bson.M{"_id": serverID, "tenant_id": tenantID}).Decode(&server)

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	session := ssh.NewSSHSession(conn, userID, tenantID, serverID, mongoDB)
	session.StartTime = time.Now()

	sessionModel := models.Session{
		ID:        session.SessionID,
		TenantID:  tenantID,
		UserID:    userID,
		ServerID:  serverID,
		StartTime: time.Now(),
		Status:    "active",
		ClientIP:  c.ClientIP(),
	}
	mongoDB.Collection("sessions").InsertOne(context.Background(), sessionModel)

	err = session.Connect(server.Host, server.Port, server.SSHUser, server.SSHPassword)
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Connection failed: "+err.Error()))
		session.Close()
		return
	}
}

func handlePlaybackWebSocket(c *gin.Context) {
	sessionID, _ := primitive.ObjectIDFromHex(c.Query("session_id"))

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	cursor, _ := mongoDB.Collection("session_frames").Find(context.Background(), bson.M{"session_id": sessionID})
	var frames []models.SessionFrame
	cursor.All(context.Background(), &frames)

	for i, frame := range frames {
		var delay int64 = 0
		if i > 0 {
			delay = frame.Offset - frames[i-1].Offset
		}
		time.Sleep(time.Duration(delay) * time.Millisecond)
		conn.WriteMessage(websocket.TextMessage, []byte(frame.Data))
	}
}
