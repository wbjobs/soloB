# System Call Monitoring and Visualization System

A comprehensive system for monitoring and visualizing system calls of specified processes using eBPF, Kafka, Flink, Elasticsearch, and React.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐              │
│  │   Collector │────▶│    Kafka    │────▶│    Flink     │              │
│  │ (eBPF/BCC)  │     │   Broker    │     │   (Stream)   │              │
│  └─────────────┘     └─────────────┘     └──────────────┘              │
│                                                              │          │
│                    ┌─────────────────────────────────────────┘          │
│                    ▼                                                    │
│         ┌──────────────────┐                                            │
│         │  Elasticsearch   │                                            │
│         │    (Storage)     │                                            │
│         └────────┬─────────┘                                            │
│                  │                                                      │
│                  ▼                                                      │
│         ┌──────────────────┐     ┌──────────────────┐                   │
│         │  Flask Backend   │────▶│  React Frontend  │                   │
│         │    (API)         │     │  (Visualization) │                   │
│         └──────────────────┘     └──────────────────┘                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Collector (C + eBPF/BCC)
- **Location**: `collector/`
- **Purpose**: Capture system calls from target process using eBPF
- **Supported syscalls**: `open`, `openat`, `read`, `write`, `connect`, `close`
- **Output**: Sends structured data to Kafka

### 2. Stream Processing (Apache Flink)
- **Location**: `flink-job/`
- **Purpose**: Consume Kafka data and perform real-time aggregation
- **Aggregation**: Per-second count of each syscall type per process
- **Output**: Writes results to Elasticsearch

### 3. Visualization Backend (Python/Flask)
- **Location**: `backend/`
- **Purpose**: REST API for querying Elasticsearch
- **Endpoints**:
  - `GET /api/health` - Health check
  - `GET /api/syscalls` - Get syscall frequency data
  - `GET /api/syscalls/by-syscall` - Aggregate by syscall type
  - `GET /api/syscalls/timeline` - Timeline data for charts
  - `GET /api/processes` - List monitored processes

### 4. Visualization Frontend (React + Recharts)
- **Location**: `frontend/`
- **Purpose**: Interactive dashboard for visualizing syscall data
- **Features**:
  - Real-time line chart of syscall frequency
  - Bar chart of syscall distribution
  - Process selection
  - Time range filtering
  - Syscall type filtering

## Prerequisites

### Hardware
- Linux kernel 4.15+ (for eBPF support)
- At least 8GB RAM (for running all components)
- At least 20GB disk space

### Software
- Docker and Docker Compose (recommended)
- OR:
  - Python 3.8+
  - Node.js 16+
  - Java 11+ (for Flink)
  - Apache Kafka
  - Elasticsearch 7.x
  - BCC tools (eBPF)

## Quick Start (Docker Compose)

### 1. Start Infrastructure
```bash
# Start Kafka, Elasticsearch, Flink, Backend, and Frontend
docker-compose up -d
```

### 2. Wait for Services
Check service health:
```bash
docker-compose ps
```

### 3. Start the Collector
**Note**: The collector requires elevated privileges and runs on the host machine (not in Docker) because eBPF needs direct kernel access.

```bash
cd collector
pip install -r requirements.txt

# Monitor a specific process (replace <PID> with target process ID)
sudo python syscall_monitor.py -p <PID> -v
```

### 4. Access the Dashboard
Open your browser and navigate to:
- **Frontend**: http://localhost:3000
- **Flink UI**: http://localhost:8081
- **Kibana**: http://localhost:5601
- **Backend API**: http://localhost:5000

## Manual Setup

### 1. Start Kafka
```bash
# Start Zookeeper
bin/zookeeper-server-start.sh config/zookeeper.properties

# Start Kafka
bin/kafka-server-start.sh config/server.properties

# Create topic
bin/kafka-topics.sh --create --topic syscalls --bootstrap-server localhost:9092
```

### 2. Start Elasticsearch
```bash
./bin/elasticsearch
```

### 3. Build and Run Flink Job
```bash
cd flink-job

# Build the job
mvn clean package

# Start Flink cluster
/path/to/flink/bin/start-cluster.sh

# Submit the job
/path/to/flink/bin/flink run target/syscall-flink-job-1.0-SNAPSHOT.jar
```

### 4. Start Backend
```bash
cd backend
pip install -r requirements.txt
python app.py
```

### 5. Start Frontend
```bash
cd frontend
npm install
npm start
```

## Configuration

### Collector
```bash
python syscall_monitor.py \
  -p <PID> \              # Target process ID
  -k localhost:9092 \     # Kafka brokers
  -t syscalls \           # Kafka topic
  -v                      # Verbose output
```

### Flink Job (Environment Variables)
```bash
export KAFKA_BROKERS="localhost:9092"
export KAFKA_TOPIC="syscalls"
export KAFKA_GROUP_ID="syscall-flink-consumer"
export ES_HOSTS="http://localhost:9200"
export ES_INDEX="syscall-aggregations"
export WINDOW_SIZE_MS="1000"  # 1 second window
```

### Backend (Environment Variables)
```bash
export ES_HOSTS="http://localhost:9200"
export ES_INDEX="syscall-aggregations"
```

## Data Flow

### 1. Raw Syscall Event (Collector → Kafka)
```json
{
  "pid": 12345,
  "tgid": 12345,
  "timestamp": 1699999999999999999,
  "syscall": "read",
  "arg1": "fd=3",
  "arg2": "",
  "ret": 1024,
  "is_exit": false,
  "is_enter": true
}
```

### 2. Aggregated Event (Flink → Elasticsearch)
```json
{
  "windowStart": 1699999999000,
  "windowEnd": 1700000000000,
  "tgid": 12345,
  "syscall": "read",
  "count": 42,
  "timestamp": 1700000000000
}
```

## Troubleshooting

### eBPF Permissions
```bash
# Ensure you have the required capabilities
sudo capsh --print | grep bpf

# Or run with sudo
sudo python syscall_monitor.py -p <PID>
```

### Kafka Connection
```bash
# Check if Kafka is running
bin/kafka-topics.sh --list --bootstrap-server localhost:9092

# Test producer
bin/kafka-console-producer.sh --topic syscalls --bootstrap-server localhost:9092

# Test consumer
bin/kafka-console-consumer.sh --topic syscalls --from-beginning --bootstrap-server localhost:9092
```

### Elasticsearch
```bash
# Check cluster health
curl http://localhost:9200/_cluster/health

# Check indices
curl http://localhost:9200/_cat/indices

# Query data
curl http://localhost:9200/syscall-aggregations/_search?pretty
```

## Development

### Collector
```bash
cd collector
pip install -r requirements.txt
sudo python syscall_monitor.py -p <PID> -v
```

### Flink Job
```bash
cd flink-job
mvn compile
mvn exec:java -Dexec.mainClass="com.syscall.monitor.SimpleSyscallAggregationJob"
```

### Backend
```bash
cd backend
pip install -r requirements.txt
FLASK_DEBUG=1 python app.py
```

### Frontend
```bash
cd frontend
npm install
npm start
```

## License

MIT License

## Contributing

Feel free to open issues or submit pull requests for improvements.
