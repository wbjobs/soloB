package config

import (
	"context"
	"database/sql"
	"log"
	"time"

	"github.com/go-redis/redis/v8"
	_ "github.com/mattn/go-sqlite3"
)

var (
	RedisClient *redis.Client
	Ctx         = context.Background()
	DB          *sql.DB
)

func InitRedis() {
	RedisClient = redis.NewClient(&redis.Options{
		Addr:     "localhost:6379",
		Password: "",
		DB:       0,
	})

	_, err := RedisClient.Ping(Ctx).Result()
	if err != nil {
		log.Printf("Warning: Could not connect to Redis: %v", err)
		log.Println("Continuing without Redis cache...")
	} else {
		log.Println("Connected to Redis successfully")
	}
}

func InitSQLite() {
	var err error
	DB, err = sql.Open("sqlite3", "./task_history.db")
	if err != nil {
		log.Fatal(err)
	}

	createTables()
	log.Println("Connected to SQLite successfully")
}

func createTables() {
	createHistoryTable := `
	CREATE TABLE IF NOT EXISTS task_history (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		priority INTEGER NOT NULL,
		burst_time REAL NOT NULL,
		remaining_time REAL NOT NULL,
		waiting_time REAL NOT NULL,
		turnaround_time REAL NOT NULL,
		preempt_count INTEGER NOT NULL,
		status TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		completed_at DATETIME
	);`

	createEntropyTable := `
	CREATE TABLE IF NOT EXISTS entropy_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		entropy REAL NOT NULL
	);`

	_, err := DB.Exec(createHistoryTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = DB.Exec(createEntropyTable)
	if err != nil {
		log.Fatal(err)
	}
}

func SaveTaskHistory(task interface{}) error {
	return nil
}

func SaveEntropy(entropy float64) error {
	_, err := DB.Exec("INSERT INTO entropy_history (entropy) VALUES (?)", entropy)
	return err
}
