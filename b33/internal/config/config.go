package config

type Config struct {
	Port        string
	RedisAddr   string
	RedisPwd    string
	RedisDB     int
}

func Load() *Config {
	return &Config{
		Port:      "8080",
		RedisAddr: "localhost:6379",
		RedisPwd:  "",
		RedisDB:   0,
	}
}
