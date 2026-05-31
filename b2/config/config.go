package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type ClusterConfig struct {
	Name       string   `mapstructure:"name"`
	Namespaces []string `mapstructure:"namespaces"`
}

type DatabaseConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	Database string `mapstructure:"database"`
	Charset  string `mapstructure:"charset"`
}

type RedisConfig struct {
	Host       string `mapstructure:"host"`
	Port       int    `mapstructure:"port"`
	Password   string `mapstructure:"password"`
	DB         int    `mapstructure:"db"`
	TTLSeconds int    `mapstructure:"ttl_seconds"`
}

type ServerConfig struct {
	Port int `mapstructure:"port"`
}

type Config struct {
	Server   ServerConfig    `mapstructure:"server"`
	Redis    RedisConfig     `mapstructure:"redis"`
	Database DatabaseConfig  `mapstructure:"database"`
	Clusters []ClusterConfig `mapstructure:"clusters"`
}

func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")

	if err := viper.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("failed to read config: %w", err)
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}

	return &cfg, nil
}

func (dc *DatabaseConfig) DSN() string {
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=%s&parseTime=True&loc=Local",
		dc.User,
		dc.Password,
		dc.Host,
		dc.Port,
		dc.Database,
		dc.Charset,
	)
}
