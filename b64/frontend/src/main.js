class FinancialDashboard {
    constructor() {
        this.chartConfig = null;
        this.dataStream = null;
        this.allCandlesticks = [];
        this.maxDataPoints = 10000;
        this.updateInterval = null;
        this.pendingCandlesticks = [];
        this.lastUpdateTime = 0;
        this.updateDelay = 100;
    }

    async init() {
        console.log('初始化金融交易数据大屏...');
        
        try {
            this.chartConfig = new ChartConfig();
            this.chartConfig.initChart('mainChart');
            this.chartConfig.setMaxDataPoints(this.maxDataPoints);
            
            this.dataStream = new DataStream({
                wsUrl: 'ws://localhost:8000',
                apiUrl: 'http://localhost:8000',
                onTrades: this.handleTrades.bind(this),
                onCandlesticks: this.handleCandlesticks.bind(this),
                onStatusChange: this.handleStatusChange.bind(this),
                onTradeCountUpdate: this.handleTradeCountUpdate.bind(this)
            });
            
            await this.dataStream.connect();
            
            this.setupWindowEvents();
            this.setupControlPanel();
            
            console.log('金融交易数据大屏初始化完成');
            
        } catch (error) {
            console.error('初始化失败:', error);
            this.handleStatusChange('初始化失败');
        }
    }

    handleTrades(trades) {
    }

    handleCandlesticks(candlesticks) {
        if (!Array.isArray(candlesticks)) {
            candlesticks = [candlesticks];
        }

        this.pendingCandlesticks.push(...candlesticks);
        
        const now = Date.now();
        if (now - this.lastUpdateTime >= this.updateDelay) {
            this.flushPendingData();
            this.lastUpdateTime = now;
        }
    }

    flushPendingData() {
        if (this.pendingCandlesticks.length === 0) return;

        const newData = this.pendingCandlesticks;
        this.pendingCandlesticks = [];

        this.allCandlesticks.push(...newData);
        
        if (this.allCandlesticks.length > this.maxDataPoints) {
            this.allCandlesticks = this.allCandlesticks.slice(-this.maxDataPoints);
        }

        if (this.chartConfig) {
            this.chartConfig.updateData(this.allCandlesticks);
        }
    }

    handleStatusChange(status) {
        const statusElement = document.getElementById('dataStatus');
        if (statusElement) {
            statusElement.textContent = status;
            
            if (status === '已连接') {
                statusElement.style.color = '#00ff88';
            } else if (status === '连接中断' || status === '连接失败') {
                statusElement.style.color = '#ff4757';
            } else {
                statusElement.style.color = '#00f5ff';
            }
        }
    }

    handleTradeCountUpdate(count) {
        const countElement = document.getElementById('tradeCount');
        if (countElement) {
            countElement.textContent = count.toLocaleString();
        }
    }

    setupWindowEvents() {
        window.addEventListener('beforeunload', () => {
            this.destroy();
        });

        window.addEventListener('focus', () => {
            if (this.chartConfig) {
                this.chartConfig.chart && this.chartConfig.chart.resize();
            }
        });
    }

    setupControlPanel() {
        const buttons = document.querySelectorAll('.control-btn');
        
        buttons.forEach(button => {
            button.addEventListener('click', (event) => {
                const target = event.currentTarget.dataset.target;
                this.toggleIndicator(target, event.currentTarget);
            });
        });
    }

    toggleIndicator(target, button) {
        if (!this.chartConfig) return;

        let isActive;
        
        switch(target) {
            case 'K线':
                isActive = this.chartConfig.toggleKLine();
                break;
            case '成交量':
                isActive = this.chartConfig.toggleVolume();
                break;
            case 'MA5':
            case 'MA10':
                isActive = this.chartConfig.toggleIndicator(target);
                break;
            default:
                return;
        }

        if (isActive) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    }

    destroy() {
        if (this.dataStream) {
            this.dataStream.disconnect();
        }
        if (this.chartConfig) {
            this.chartConfig.dispose();
        }
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
        console.log('金融交易数据大屏已销毁');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new FinancialDashboard();
    dashboard.init();
});
