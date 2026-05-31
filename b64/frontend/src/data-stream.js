class DataStream {
    constructor(options = {}) {
        this.wsUrl = options.wsUrl || 'ws://localhost:8000';
        this.apiUrl = options.apiUrl || 'http://localhost:8000';
        this.tradesWs = null;
        this.candlesticksWs = null;
        this.tradeCount = 0;
        this.lastCountUpdate = Date.now();
        this.callbacks = {
            onTrades: options.onTrades || null,
            onCandlesticks: options.onCandlesticks || null,
            onStatusChange: options.onStatusChange || null,
            onTradeCountUpdate: options.onTradeCountUpdate || null
        };
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.isConnected = false;
    }

    async connect() {
        try {
            this.updateStatus('正在连接...');
            
            const historicalData = await this.fetchHistoricalData(1000);
            if (this.callbacks.onCandlesticks) {
                this.callbacks.onCandlesticks(historicalData);
            }
            
            this.connectTradesWebSocket();
            this.connectCandlesticksWebSocket();
            
        } catch (error) {
            console.error('连接失败:', error);
            this.updateStatus('连接失败，正在重试...');
            this.attemptReconnect();
        }
    }

    async fetchHistoricalData(count = 1000) {
        try {
            const response = await fetch(`${this.apiUrl}/api/historical/${count}`);
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('获取历史数据失败:', error);
            throw error;
        }
    }

    connectTradesWebSocket() {
        try {
            this.tradesWs = new WebSocket(`${this.wsUrl}/ws/trades`);
            
            this.tradesWs.onopen = () => {
                console.log('交易数据WebSocket已连接');
                this.checkConnectionStatus();
            };

            this.tradesWs.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'trades') {
                        this.handleTrades(message.data);
                    }
                } catch (error) {
                    console.error('解析交易数据失败:', error);
                }
            };

            this.tradesWs.onclose = () => {
                console.log('交易数据WebSocket已断开');
                this.checkConnectionStatus();
                this.attemptReconnect();
            };

            this.tradesWs.onerror = (error) => {
                console.error('交易数据WebSocket错误:', error);
            };

        } catch (error) {
            console.error('创建交易数据WebSocket失败:', error);
            this.attemptReconnect();
        }
    }

    connectCandlesticksWebSocket() {
        try {
            this.candlesticksWs = new WebSocket(`${this.wsUrl}/ws/candlesticks`);
            
            this.candlesticksWs.onopen = () => {
                console.log('K线数据WebSocket已连接');
                this.checkConnectionStatus();
            };

            this.candlesticksWs.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'candlesticks') {
                        this.handleCandlesticks(message.data);
                    }
                } catch (error) {
                    console.error('解析K线数据失败:', error);
                }
            };

            this.candlesticksWs.onclose = () => {
                console.log('K线数据WebSocket已断开');
                this.checkConnectionStatus();
                this.attemptReconnect();
            };

            this.candlesticksWs.onerror = (error) => {
                console.error('K线数据WebSocket错误:', error);
            };

        } catch (error) {
            console.error('创建K线数据WebSocket失败:', error);
            this.attemptReconnect();
        }
    }

    handleTrades(trades) {
        this.tradeCount += trades.length;
        
        const now = Date.now();
        if (now - this.lastCountUpdate >= 1000) {
            if (this.callbacks.onTradeCountUpdate) {
                this.callbacks.onTradeCountUpdate(this.tradeCount);
            }
            this.tradeCount = 0;
            this.lastCountUpdate = now;
        }

        if (this.callbacks.onTrades) {
            this.callbacks.onTrades(trades);
        }
    }

    handleCandlesticks(candlesticks) {
        if (this.callbacks.onCandlesticks) {
            this.callbacks.onCandlesticks(candlesticks);
        }
    }

    checkConnectionStatus() {
        const tradesConnected = this.tradesWs && this.tradesWs.readyState === WebSocket.OPEN;
        const candlesticksConnected = this.candlesticksWs && this.candlesticksWs.readyState === WebSocket.OPEN;
        
        const wasConnected = this.isConnected;
        this.isConnected = tradesConnected && candlesticksConnected;
        
        if (this.isConnected !== wasConnected) {
            if (this.isConnected) {
                this.updateStatus('已连接');
                this.reconnectAttempts = 0;
            } else {
                this.updateStatus('连接中断');
            }
        }
    }

    updateStatus(status) {
        if (this.callbacks.onStatusChange) {
            this.callbacks.onStatusChange(status);
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('达到最大重连次数，停止重连');
            this.updateStatus('连接失败');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})，${delay}ms后重试...`);
        this.updateStatus(`正在重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        setTimeout(() => {
            if (!this.tradesWs || this.tradesWs.readyState !== WebSocket.OPEN) {
                this.connectTradesWebSocket();
            }
            if (!this.candlesticksWs || this.candlesticksWs.readyState !== WebSocket.OPEN) {
                this.connectCandlesticksWebSocket();
            }
        }, delay);
    }

    disconnect() {
        if (this.tradesWs) {
            this.tradesWs.close();
            this.tradesWs = null;
        }
        if (this.candlesticksWs) {
            this.candlesticksWs.close();
            this.candlesticksWs = null;
        }
        this.isConnected = false;
        this.updateStatus('已断开');
        console.log('数据连接已断开');
    }

    setCallback(type, callback) {
        if (this.callbacks.hasOwnProperty(type)) {
            this.callbacks[type] = callback;
        }
    }
}

window.DataStream = DataStream;
