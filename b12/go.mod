module dtsplatform

go 1.22

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/robfig/cron/v3 v3.0.1
	go.etcd.io/etcd/client/v3 v3.5.10
	google.golang.org/grpc v1.60.1
	google.golang.org/protobuf v1.32.0
	github.com/segmentio/kafka-go v0.4.47
	github.com/jackc/pgx/v5 v5.5.3
	github.com/redis/go-redis/v9 v9.4.0
	github.com/minio/minio-go/v7 v7.0.66
	github.com/prometheus/client_golang v1.18.0
	github.com/spf13/cobra v1.8.0
	github.com/spf13/viper v1.18.2
	github.com/docker/docker v25.0.0+incompatible
	github.com/docker/go-connections v0.4.0
	golang.org/x/sync v0.6.0
	golang.org/x/net v0.21.0
	google.golang.org/grpc/cmd/protoc-gen-go-grpc v1.3.0
	k8s.io/api v0.29.2
	k8s.io/apimachinery v0.29.2
	k8s.io/client-go v0.29.2
)
