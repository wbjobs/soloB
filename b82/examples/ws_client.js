class IoTLoadPredictionClient {
    constructor(wsUrl, clientId) {
        this.wsUrl = wsUrl;
        this.clientId = clientId || 'web-client-' + Date.now();
        this.subscriptions = new Set();
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectInterval = 3000;
    }

    connect() {
        const url = `${this.wsUrl}?client_id=${this.clientId}`;
        console.log(`Connecting to ${url}...`);
        
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            
            this.subscriptions.forEach(meterId => {
                this.subscribe(meterId);
            });
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleMessage(data);
            } catch (e) {
                console.error('Failed to parse message:', e);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.attemptReconnect();
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'prediction_update':
                this.onPredictionUpdate(data);
                break;
            default:
                console.log('Received message:', data);
        }
    }

    onPredictionUpdate(data) {
        console.log(`Prediction for ${data.meter_id} at ${data.time}:`);
        console.log(`  Load values: ${data.payload.load_values}`);
        console.log(`  Time labels: ${data.payload.time_labels}`);
        console.log(`  Confidence: ${data.payload.confidence}`);
    }

    subscribe(meterId) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.subscriptions.add(meterId);
            return;
        }

        const message = {
            type: 'subscribe',
            meter_id: meterId
        };

        this.ws.send(JSON.stringify(message));
        this.subscriptions.add(meterId);
        console.log(`Subscribed to meter ${meterId}`);
    }

    unsubscribe(meterId) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = {
                type: 'unsubscribe',
                meter_id: meterId
            };
            this.ws.send(JSON.stringify(message));
        }
        this.subscriptions.delete(meterId);
        console.log(`Unsubscribed from meter ${meterId}`);
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        console.log(`Reconnecting... attempt ${this.reconnectAttempts}`);
        
        setTimeout(() => {
            this.connect();
        }, this.reconnectInterval);
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

// 示例使用
if (typeof window !== 'undefined') {
    const client = new IoTLoadPredictionClient('ws://localhost:8080/api/v1/ws');
    
    client.onPredictionUpdate = (data) => {
        console.log('Prediction update received:', data);
        updateChart(data);
    };

    client.connect();
    client.subscribe('meter-0001');
    client.subscribe('meter-0002');
}

function updateChart(data) {
    console.log('Updating chart with prediction:', data.payload);
}

module.exports = IoTLoadPredictionClient;
