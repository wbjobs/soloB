class ChartConfig {
    constructor() {
        this.chart = null;
        this.maxDataPoints = 10000;
        this.priceAxisRange = null;
        this.volumeAxisRange = null;
        this.isYAxisLocked = false;
        
        this.indicators = {
            MA5: {
                enabled: true,
                period: 5,
                color: '#ffd700'
            },
            MA10: {
                enabled: true,
                period: 10,
                color: '#ff69b4'
            }
        };
        
        this.showKLine = true;
        this.showVolume = true;
    }

    initChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            throw new Error(`容器 ${containerId} 未找到`);
        }

        this.chart = echarts.init(container, 'dark');
        
        const option = this.getBaseOption();
        this.chart.setOption(option);
        
        this.setupEvents();
        
        return this.chart;
    }

    getBaseOption() {
        return {
            backgroundColor: 'transparent',
            title: {
                text: '实时K线图',
                subtext: '支持每秒1000+数据点',
                left: 'center',
                top: 10,
                textStyle: {
                    color: '#ffffff',
                    fontSize: 18,
                    fontWeight: 600
                },
                subtextStyle: {
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: 12
                }
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross'
                },
                backgroundColor: 'rgba(15, 12, 41, 0.9)',
                borderColor: 'rgba(0, 245, 255, 0.5)',
                borderWidth: 1,
                textStyle: {
                    color: '#ffffff'
                },
                formatter: function(params) {
                    if (!params || params.length === 0) return '';
                    
                    const data = params[0];
                    if (!data || !data.data) return '';
                    
                    const candleData = data.data;
                    const timestamp = new Date(candleData[0] * 1000);
                    const formattedTime = timestamp.toLocaleString('zh-CN');
                    
                    let html = `<div style="font-weight: bold; margin-bottom: 8px; color: #00f5ff;">${formattedTime}</div>`;
                    html += `<div style="margin-bottom: 4px;">开盘: <span style="color: #fff;">${candleData[1].toFixed(2)}</span></div>`;
                    html += `<div style="margin-bottom: 4px;">收盘: <span style="color: ${candleData[1] <= candleData[2] ? '#00ff88' : '#ff4757'};">${candleData[2].toFixed(2)}</span></div>`;
                    html += `<div style="margin-bottom: 4px;">最高: <span style="color: #00ff88;">${candleData[3].toFixed(2)}</span></div>`;
                    html += `<div style="margin-bottom: 4px;">最低: <span style="color: #ff4757;">${candleData[4].toFixed(2)}</span></div>`;
                    html += `<div>成交量: <span style="color: #9d00ff;">${candleData[5].toFixed(2)}</span></div>`;
                    
                    return html;
                }
            },
            legend: {
                data: ['K线', 'MA5', 'MA10', '成交量'],
                top: 50,
                textStyle: {
                    color: 'rgba(255, 255, 255, 0.8)'
                },
                selectedMode: true,
                selected: {
                    'K线': true,
                    'MA5': true,
                    'MA10': true,
                    '成交量': true
                }
            },
            grid: [
                {
                    left: '10%',
                    right: '8%',
                    top: 120,
                    height: '45%'
                },
                {
                    left: '10%',
                    right: '8%',
                    top: '65%',
                    height: '20%'
                }
            ],
            xAxis: [
                {
                    type: 'category',
                    data: [],
                    boundaryGap: false,
                    axisLine: {
                        lineStyle: {
                            color: 'rgba(255, 255, 255, 0.2)'
                        }
                    },
                    axisLabel: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        formatter: function(value) {
                            if (typeof value === 'number') {
                                return new Date(value * 1000).toLocaleTimeString('zh-CN', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                });
                            }
                            return value;
                        }
                    },
                    splitLine: {
                        show: false
                    },
                    axisPointer: {
                        type: 'cross'
                    }
                },
                {
                    type: 'category',
                    gridIndex: 1,
                    data: [],
                    boundaryGap: false,
                    axisLine: {
                        lineStyle: {
                            color: 'rgba(255, 255, 255, 0.2)'
                        }
                    },
                    axisLabel: {
                        show: false
                    },
                    splitLine: {
                        show: false
                    }
                }
            ],
            yAxis: [
                {
                    scale: true,
                    min: null,
                    max: null,
                    splitArea: {
                        show: false
                    },
                    axisLine: {
                        lineStyle: {
                            color: 'rgba(255, 255, 255, 0.2)'
                        }
                    },
                    axisLabel: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        formatter: function(value) {
                            return value.toFixed(2);
                        }
                    },
                    splitLine: {
                        lineStyle: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    }
                },
                {
                    scale: true,
                    min: null,
                    max: null,
                    gridIndex: 1,
                    splitNumber: 2,
                    axisLine: {
                        lineStyle: {
                            color: 'rgba(255, 255, 255, 0.2)'
                        }
                    },
                    axisLabel: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        formatter: function(value) {
                            return value.toFixed(1);
                        }
                    },
                    splitLine: {
                        lineStyle: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        }
                    }
                }
            ],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: [0, 1],
                    start: 80,
                    end: 100,
                    zoomOnMouseWheel: true,
                    moveOnMouseMove: true,
                    moveOnMouseWheel: false
                },
                {
                    type: 'slider',
                    xAxisIndex: [0, 1],
                    start: 80,
                    end: 100,
                    bottom: 10,
                    height: 20,
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    fillerColor: 'rgba(0, 245, 255, 0.2)',
                    handleStyle: {
                        color: '#00f5ff',
                        borderColor: '#00f5ff'
                    },
                    moveHandleStyle: {
                        color: 'rgba(255, 255, 255, 0.8)'
                    },
                    selectedDataBackground: {
                        lineStyle: {
                            color: '#00f5ff'
                        },
                        areaStyle: {
                            color: 'rgba(0, 245, 255, 0.2)'
                        }
                    },
                    textStyle: {
                        color: 'rgba(255, 255, 255, 0.6)'
                    }
                }
            ],
            axisPointer: {
                link: [
                    {
                        xAxisIndex: 'all'
                    }
                ],
                label: {
                    backgroundColor: 'rgba(0, 245, 255, 0.8)',
                    color: '#000',
                    fontSize: 12
                },
                lineStyle: {
                    color: 'rgba(0, 245, 255, 0.5)',
                    type: 'dashed'
                },
                crossStyle: {
                    color: 'rgba(0, 245, 255, 0.5)'
                }
            },
            series: [
                {
                    name: 'K线',
                    type: 'candlestick',
                    data: [],
                    large: true,
                    largeThreshold: 1000,
                    itemStyle: {
                        color: '#00ff88',
                        color0: '#ff4757',
                        borderColor: '#00ff88',
                        borderColor0: '#ff4757'
                    },
                    emphasis: {
                        itemStyle: {
                            borderWidth: 2
                        }
                    }
                },
                {
                    name: 'MA5',
                    type: 'line',
                    data: [],
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        color: '#ffd700',
                        width: 1.5
                    }
                },
                {
                    name: 'MA10',
                    type: 'line',
                    data: [],
                    smooth: true,
                    symbol: 'none',
                    lineStyle: {
                        color: '#ff69b4',
                        width: 1.5
                    }
                },
                {
                    name: '成交量',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: [],
                    large: true,
                    largeThreshold: 1000,
                    itemStyle: {
                        color: function(params) {
                            if (!params.data || !params.data[2]) return '#9d00ff';
                            const open = params.data[2];
                            const close = params.data[1];
                            return close >= open ? 'rgba(0, 255, 136, 0.6)' : 'rgba(255, 71, 87, 0.6)';
                        }
                    }
                }
            ],
            animation: false,
            hoverAnimation: false,
            progressive: 1000,
            progressiveThreshold: 3000
        };
    }

    setupEvents() {
        if (!this.chart) return;

        window.addEventListener('resize', () => {
            this.chart.resize();
        });

        this.chart.on('legendselectchanged', (params) => {
            if (params.selected.hasOwnProperty('K线')) {
                this.showKLine = params.selected['K线'];
            }
            if (params.selected.hasOwnProperty('MA5')) {
                this.indicators.MA5.enabled = params.selected['MA5'];
            }
            if (params.selected.hasOwnProperty('MA10')) {
                this.indicators.MA10.enabled = params.selected['MA10'];
            }
            if (params.selected.hasOwnProperty('成交量')) {
                this.showVolume = params.selected['成交量'];
            }
            console.log('指标显示状态变更:', {
                K线: this.showKLine,
                MA5: this.indicators.MA5.enabled,
                MA10: this.indicators.MA10.enabled,
                成交量: this.showVolume
            });
        });
    }

    calculateMA(closePrices, period) {
        const result = [];
        
        for (let i = 0; i < closePrices.length; i++) {
            if (i < period - 1) {
                result.push(null);
                continue;
            }
            
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += closePrices[i - j];
            }
            result.push(sum / period);
        }
        
        return result;
    }

    calculateAllIndicators(klineData) {
        const closePrices = klineData.map(candle => candle[2]);
        const timestamps = klineData.map(candle => candle[0]);
        
        const indicators = {
            MA5: [],
            MA10: []
        };
        
        if (Object.keys(this.indicators).length === 0) {
            return indicators;
        }
        
        for (const [name, config] of Object.entries(this.indicators)) {
            if (!config.enabled) continue;
            
            const maData = this.calculateMA(closePrices, config.period);
            indicators[name] = maData.map((value, index) => {
                if (value === null) return null;
                return [timestamps[index], value];
            });
        }
        
        return indicators;
    }

    updateData(candlestickData) {
        if (!this.chart || candlestickData.length === 0) return;

        const klineData = [];
        const volumeData = [];
        const xAxisData = [];

        candlestickData.forEach(candle => {
            xAxisData.push(candle.timestamp);
            klineData.push([
                candle.timestamp,
                candle.open,
                candle.close,
                candle.high,
                candle.low,
                candle.volume
            ]);
            volumeData.push([
                candle.timestamp,
                candle.volume,
                candle.open,
                candle.close
            ]);
        });

        if (xAxisData.length > this.maxDataPoints) {
            const startIndex = xAxisData.length - this.maxDataPoints;
            xAxisData.splice(0, startIndex);
            klineData.splice(0, startIndex);
            volumeData.splice(0, startIndex);
        }

        const indicators = this.calculateAllIndicators(klineData);

        if (!this.isYAxisLocked) {
            this.calculateAndLockYAxisRange(candlestickData);
        }

        const updateOption = {
            xAxis: [
                {
                    data: xAxisData
                },
                {
                    data: xAxisData
                }
            ],
            series: [
                {
                    data: klineData
                },
                {
                    data: indicators.MA5 || []
                },
                {
                    data: indicators.MA10 || []
                },
                {
                    data: volumeData
                }
            ]
        };

        if (this.isYAxisLocked && this.priceAxisRange && this.volumeAxisRange) {
            updateOption.yAxis = [
                {
                    min: this.priceAxisRange.min,
                    max: this.priceAxisRange.max
                },
                {
                    min: this.volumeAxisRange.min,
                    max: this.volumeAxisRange.max
                }
            ];
        }

        this.chart.setOption(updateOption, {
            notMerge: false,
            lazyUpdate: true,
            silent: true
        });
    }

    calculateAndLockYAxisRange(candlestickData) {
        if (candlestickData.length === 0) return;

        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let maxVolume = 0;

        candlestickData.forEach(candle => {
            if (candle.low < minPrice) minPrice = candle.low;
            if (candle.high > maxPrice) maxPrice = candle.high;
            if (candle.volume > maxVolume) maxVolume = candle.volume;
        });

        const pricePadding = (maxPrice - minPrice) * 0.1;
        this.priceAxisRange = {
            min: minPrice - pricePadding,
            max: maxPrice + pricePadding
        };

        this.volumeAxisRange = {
            min: 0,
            max: maxVolume * 1.2
        };

        this.isYAxisLocked = true;
        console.log('Y轴范围已锁定:', this.priceAxisRange, this.volumeAxisRange);
    }

    unlockYAxis() {
        this.isYAxisLocked = false;
        this.priceAxisRange = null;
        this.volumeAxisRange = null;
        
        if (this.chart) {
            this.chart.setOption({
                yAxis: [
                    {
                        min: null,
                        max: null
                    },
                    {
                        min: null,
                        max: null
                    }
                ]
            });
        }
        console.log('Y轴范围已解锁');
    }

    setYAxisRange(priceMin, priceMax, volumeMin = 0, volumeMax = null) {
        this.priceAxisRange = {
            min: priceMin,
            max: priceMax
        };
        
        this.volumeAxisRange = {
            min: volumeMin,
            max: volumeMax
        };
        
        this.isYAxisLocked = true;
        console.log('Y轴范围已手动设置:', this.priceAxisRange, this.volumeAxisRange);
    }

    addData(newCandle) {
        if (!this.chart) return;

        const currentOption = this.chart.getOption();
        
        let xAxisData = currentOption.xAxis[0].data || [];
        let klineData = currentOption.series[0].data || [];
        let volumeData = currentOption.series[3].data || [];

        xAxisData.push(newCandle.timestamp);
        klineData.push([
            newCandle.timestamp,
            newCandle.open,
            newCandle.close,
            newCandle.high,
            newCandle.low,
            newCandle.volume
        ]);
        volumeData.push([
            newCandle.timestamp,
            newCandle.volume,
            newCandle.open,
            newCandle.close
        ]);

        if (xAxisData.length > this.maxDataPoints) {
            xAxisData.shift();
            klineData.shift();
            volumeData.shift();
        }

        const indicators = this.calculateAllIndicators(klineData);

        if (!this.isYAxisLocked && xAxisData.length >= 100) {
            this.calculateAndLockYAxisRangeFromData(klineData, volumeData);
        }

        const updateOption = {
            xAxis: [
                {
                    data: xAxisData
                },
                {
                    data: xAxisData
                }
            ],
            series: [
                {
                    data: klineData
                },
                {
                    data: indicators.MA5 || []
                },
                {
                    data: indicators.MA10 || []
                },
                {
                    data: volumeData
                }
            ]
        };

        if (this.isYAxisLocked && this.priceAxisRange && this.volumeAxisRange) {
            updateOption.yAxis = [
                {
                    min: this.priceAxisRange.min,
                    max: this.priceAxisRange.max
                },
                {
                    min: this.volumeAxisRange.min,
                    max: this.volumeAxisRange.max
                }
            ];
        }

        this.chart.setOption(updateOption, {
            notMerge: false,
            lazyUpdate: true,
            silent: true
        });
    }

    calculateAndLockYAxisRangeFromData(klineData, volumeData) {
        if (klineData.length === 0) return;

        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let maxVolume = 0;

        klineData.forEach(candle => {
            const low = candle[4];
            const high = candle[3];
            if (low < minPrice) minPrice = low;
            if (high > maxPrice) maxPrice = high;
        });

        volumeData.forEach(vol => {
            if (vol[1] > maxVolume) maxVolume = vol[1];
        });

        const pricePadding = (maxPrice - minPrice) * 0.1;
        this.priceAxisRange = {
            min: minPrice - pricePadding,
            max: maxPrice + pricePadding
        };

        this.volumeAxisRange = {
            min: 0,
            max: maxVolume * 1.2
        };

        this.isYAxisLocked = true;
        console.log('Y轴范围已从现有数据锁定:', this.priceAxisRange, this.volumeAxisRange);
    }

    setMaxDataPoints(maxPoints) {
        this.maxDataPoints = maxPoints;
    }

    toggleIndicator(name) {
        if (!this.indicators.hasOwnProperty(name)) return false;
        
        this.indicators[name].enabled = !this.indicators[name].enabled;
        
        if (this.chart) {
            this.chart.dispatchAction({
                type: 'legendToggleSelect',
                name: name
            });
        }
        
        console.log(`${name} 指标已${this.indicators[name].enabled ? '显示' : '隐藏'}`);
        return this.indicators[name].enabled;
    }

    showIndicator(name) {
        if (!this.indicators.hasOwnProperty(name)) return;
        
        this.indicators[name].enabled = true;
        
        if (this.chart) {
            this.chart.dispatchAction({
                type: 'legendSelect',
                name: name
            });
        }
        
        console.log(`${name} 指标已显示`);
    }

    hideIndicator(name) {
        if (!this.indicators.hasOwnProperty(name)) return;
        
        this.indicators[name].enabled = false;
        
        if (this.chart) {
            this.chart.dispatchAction({
                type: 'legendUnSelect',
                name: name
            });
        }
        
        console.log(`${name} 指标已隐藏`);
    }

    toggleKLine() {
        this.showKLine = !this.showKLine;
        
        if (this.chart) {
            this.chart.dispatchAction({
                type: 'legendToggleSelect',
                name: 'K线'
            });
        }
        
        console.log(`K线图已${this.showKLine ? '显示' : '隐藏'}`);
        return this.showKLine;
    }

    toggleVolume() {
        this.showVolume = !this.showVolume;
        
        if (this.chart) {
            this.chart.dispatchAction({
                type: 'legendToggleSelect',
                name: '成交量'
            });
        }
        
        console.log(`成交量已${this.showVolume ? '显示' : '隐藏'}`);
        return this.showVolume;
    }

    getIndicatorStatus() {
        return {
            KLine: this.showKLine,
            MA5: this.indicators.MA5.enabled,
            MA10: this.indicators.MA10.enabled,
            Volume: this.showVolume
        };
    }

    dispose() {
        if (this.chart) {
            this.chart.dispose();
            this.chart = null;
        }
    }
}

window.ChartConfig = ChartConfig;
