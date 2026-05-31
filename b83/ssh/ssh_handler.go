package ssh

import (
	"context"
	"io"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"golang.org/x/crypto/ssh"

	"web-ssh-bastion/models"
	"web-ssh-bastion/security"
)

type SSHSession struct {
	WSConn       *websocket.Conn
	SSHClient    *ssh.Client
	SSHSession   *ssh.Session
	StdinPipe    io.WriteCloser
	StdoutPipe   io.Reader
	SessionID    primitive.ObjectID
	UserID       primitive.ObjectID
	TenantID     primitive.ObjectID
	ServerID     primitive.ObjectID
	StartTime    time.Time
	LastCommand  string
	MongoDB      *mongo.Database
	lastFrameTime time.Time
	frameBuffer  string
}

func NewSSHSession(ws *websocket.Conn, userID, tenantID, serverID primitive.ObjectID, db *mongo.Database) *SSHSession {
	now := time.Now()
	return &SSHSession{
		WSConn:        ws,
		SessionID:     primitive.NewObjectID(),
		UserID:        userID,
		TenantID:      tenantID,
		ServerID:      serverID,
		StartTime:     now,
		lastFrameTime: now,
		MongoDB:       db,
	}
}

func (s *SSHSession) Connect(host string, port int, username, password string) error {
	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}

	addr := host + ":" + strconv.Itoa(port)
	client, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		return err
	}
	s.SSHClient = client

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return err
	}
	s.SSHSession = session

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm", 40, 120, modes); err != nil {
		session.Close()
		client.Close()
		return err
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return err
	}
	s.StdinPipe = stdin

	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return err
	}
	s.StdoutPipe = stdout

	if err := session.Shell(); err != nil {
		session.Close()
		client.Close()
		return err
	}

	go s.readOutput()
	go s.readInput()

	return nil
}

func (s *SSHSession) readOutput() {
	buf := make([]byte, 4096)
	for {
		n, err := s.StdoutPipe.Read(buf)
		if err != nil {
			return
		}
		if n > 0 {
			data := string(buf[:n])
			now := time.Now()
			s.saveFrameWithTime(data, now)
			s.WSConn.WriteMessage(websocket.TextMessage, []byte(data))
		}
	}
}

func (s *SSHSession) readInput() {
	for {
		_, msg, err := s.WSConn.ReadMessage()
		if err != nil {
			s.Close()
			return
		}

		input := string(msg)
		s.LastCommand += input

		if input == "\r" || input == "\n" {
			cmd := s.LastCommand
			checkResult := security.CheckCommand(cmd)
			if checkResult.Blocked {
				s.saveCommand(cmd, "", true, true)
				s.createAlert(cmd, checkResult)
				s.StdinPipe.Write([]byte("\x03"))
				s.WSConn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m[BLOCKED] "+checkResult.Message+"\x1b[0m\r\n"))
			} else {
				s.saveCommand(cmd, "", checkResult.IsDangerous, false)
				s.StdinPipe.Write(msg)
			}
			s.LastCommand = ""
		} else {
			s.StdinPipe.Write(msg)
		}
	}
}

func (s *SSHSession) saveFrameWithTime(data string, t time.Time) {
	frame := models.SessionFrame{
		SessionID: s.SessionID,
		Timestamp: t,
		Offset:    t.Sub(s.StartTime).Milliseconds(),
		Data:      data,
	}
	s.MongoDB.Collection("session_frames").InsertOne(context.Background(), frame)
}

func (s *SSHSession) saveFrame(data string) {
	s.saveFrameWithTime(data, time.Now())
}

func (s *SSHSession) saveCommand(cmd, output string, isDangerous, blocked bool) {
	record := models.CommandRecord{
		SessionID:   s.SessionID,
		TenantID:    s.TenantID,
		UserID:      s.UserID,
		Command:     cmd,
		Output:      output,
		Timestamp:   time.Now(),
		IsDangerous: isDangerous,
		Blocked:     blocked,
	}
	s.MongoDB.Collection("command_records").InsertOne(context.Background(), record)
}

func (s *SSHSession) createAlert(cmd string, result security.CheckResult) {
	alert := models.Alert{
		TenantID:  s.TenantID,
		SessionID: s.SessionID,
		UserID:    s.UserID,
		Command:   cmd,
		Message:   result.Message,
		Level:     result.Level,
		Timestamp: time.Now(),
	}
	s.MongoDB.Collection("alerts").InsertOne(context.Background(), alert)
}

func (s *SSHSession) Close() {
	if s.SSHSession != nil {
		s.SSHSession.Close()
	}
	if s.SSHClient != nil {
		s.SSHClient.Close()
	}
	if s.WSConn != nil {
		s.WSConn.Close()
	}

	now := time.Now()
	s.MongoDB.Collection("sessions").UpdateOne(
		context.Background(),
		bson.M{"_id": s.SessionID},
		bson.M{"$set": bson.M{"end_time": now, "status": "ended"}},
	)
}
