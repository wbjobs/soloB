package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Tenant struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name      string             `bson:"name" json:"name"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
}

type User struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TenantID  primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	Username  string             `bson:"username" json:"username"`
	Password  string             `bson:"password" json:"-"`
	Role      string             `bson:"role" json:"role"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
}

type Server struct {
	ID             primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TenantID       primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	Name           string             `bson:"name" json:"name"`
	Host           string             `bson:"host" json:"host"`
	Port           int                `bson:"port" json:"port"`
	SSHUser        string             `bson:"ssh_user" json:"ssh_user"`
	SSHPassword    string             `bson:"ssh_password,omitempty" json:"-"`
	SSHKey         string             `bson:"ssh_key,omitempty" json:"-"`
	CreatedAt      time.Time          `bson:"created_at" json:"created_at"`
}

type Session struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TenantID    primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	UserID      primitive.ObjectID `bson:"user_id" json:"user_id"`
	ServerID    primitive.ObjectID `bson:"server_id" json:"server_id"`
	StartTime   time.Time          `bson:"start_time" json:"start_time"`
	EndTime     *time.Time         `bson:"end_time,omitempty" json:"end_time,omitempty"`
	Status      string             `bson:"status" json:"status"`
	ClientIP    string             `bson:"client_ip" json:"client_ip"`
}

type CommandRecord struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	SessionID   primitive.ObjectID `bson:"session_id" json:"session_id"`
	TenantID    primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	UserID      primitive.ObjectID `bson:"user_id" json:"user_id"`
	Command     string             `bson:"command" json:"command"`
	Output      string             `bson:"output" json:"output"`
	Timestamp   time.Time          `bson:"timestamp" json:"timestamp"`
	IsDangerous bool               `bson:"is_dangerous" json:"is_dangerous"`
	Blocked     bool               `bson:"blocked" json:"blocked"`
}

type SessionFrame struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	SessionID   primitive.ObjectID `bson:"session_id" json:"session_id"`
	Timestamp   time.Time          `bson:"timestamp" json:"timestamp"`
	Offset      int64              `bson:"offset" json:"offset"`
	Data        string             `bson:"data" json:"data"`
}

type Alert struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	TenantID    primitive.ObjectID `bson:"tenant_id" json:"tenant_id"`
	SessionID   primitive.ObjectID `bson:"session_id" json:"session_id"`
	UserID      primitive.ObjectID `bson:"user_id" json:"user_id"`
	Command     string             `bson:"command" json:"command"`
	Message     string             `bson:"message" json:"message"`
	Level       string             `bson:"level" json:"level"`
	Timestamp   time.Time          `bson:"timestamp" json:"timestamp"`
}
