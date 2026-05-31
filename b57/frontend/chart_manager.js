var TechnicalIndicators = {
    SMA: function(closes, period) {
        var result = [];
        for (var i = 0; i < closes.length; i++) {
            if (i < period - 1) {
                result.push(null);
            } else {
                var sum = 0;
                for (var j = 0; j < period; j++) {
                    sum += closes[i - j];
                }
                result.push(sum / period);
            }
        }
        return result;
    },

    EMA: function(closes, period) {
        var result = [];
        var multiplier = 2 / (period + 1);
        var prevEma = null;
        
        for (var i = 0; i < closes.length; i++) {
            if (i < period - 1) {
                result.push(null);
            } else if (i === period - 1) {
                var sum = 0;
                for (var j = 0; j < period; j++) {
                    sum += closes[i - j];
                }
                prevEma = sum / period;
                result.push(prevEma);
            } else {
                prevEma = (closes[i] - prevEma) * multiplier + prevEma;
                result.push(prevEma);
            }
        }
        return result;
    },

    MACD: function(closes, fastPeriod, slowPeriod, signalPeriod) {
        fastPeriod = fastPeriod || 12;
        slowPeriod = slowPeriod || 26;
        signalPeriod = signalPeriod || 9;
        
        var fastEma = this.EMA(closes, fastPeriod);
        var slowEma = this.EMA(closes, slowPeriod);
        
        var macdLine = [];
        for (var i = 0; i < closes.length; i++) {
            if (fastEma[i] !== null && slowEma[i] !== null) {
                macdLine.push(fastEma[i] - slowEma[i]);
            } else {
                macdLine.push(null);
            }
        }
        
        var validMacd = [];
        var macdIndices = [];
        for (var i = 0; i < macdLine.length; i++) {
            if (macdLine[i] !== null) {
                validMacd.push(macdLine[i]);
                macdIndices.push(i);
            }
        }
        
        var signalLineRaw = this.EMA(validMacd, signalPeriod);
        var signalLine = new Array(closes.length).fill(null);
        for (var j = 0; j < signalLineRaw.length; j++) {
            if (signalLineRaw[j] !== null) {
                signalLine[macdIndices[j]] = signalLineRaw[j];
            }
        }
        
        var histogram = [];
        for (var k = 0; k < closes.length; k++) {
            if (macdLine[k] !== null && signalLine[k] !== null) {
                histogram.push(macdLine[k] - signalLine[k]);
            } else {
                histogram.push(null);
            }
        }
        
        return {
            macd: macdLine,
            signal: signalLine,
            histogram: histogram
        };
    },

    RSI: function(closes, period) {
        period = period || 14;
        var result = [];
        var gains = [];
        var losses = [];
        
        for (var i = 0; i < closes.length; i++) {
            if (i === 0) {
                gains.push(0);
                losses.push(0);
            } else {
                var change = closes[i] - closes[i - 1];
                if (change > 0) {
                    gains.push(change);
                    losses.push(0);
                } else {
                    gains.push(0);
                    losses.push(Math.abs(change));
                }
            }
        }
        
        var avgGain = 0;
        var avgLoss = 0;
        
        for (var j = 0; j < closes.length; j++) {
            if (j < period) {
                result.push(null);
            } else if (j === period) {
                var gainSum = 0;
                var lossSum = 0;
                for (var k = 1; k <= period; k++) {
                    gainSum += gains[j - k];
                    lossSum += losses[j - k];
                }
                avgGain = gainSum / period;
                avgLoss = lossSum / period;
                
                if (avgLoss === 0) {
                    result.push(100);
                } else {
                    var rs = avgGain / avgLoss;
                    result.push(100 - (100 / (1 + rs)));
                }
            } else {
                avgGain = (avgGain * (period - 1) + gains[j]) / period;
                avgLoss = (avgLoss * (period - 1) + losses[j]) / period;
                
                if (avgLoss === 0) {
                    result.push(100);
                } else {
                    var rsCurrent = avgGain / avgLoss;
                    result.push(100 - (100 / (1 + rsCurrent)));
                }
            }
        }
        
        return result;
    },

    BollingerBands: function(closes, period, stdDev) {
        period = period || 20;
        stdDev = stdDev || 2;
        
        var middle = this.SMA(closes, period);
        var upper = [];
        var lower = [];
        
        for (var i = 0; i < closes.length; i++) {
            if (i < period - 1) {
                upper.push(null);
                lower.push(null);
            } else {
                var sumSq = 0;
                var mean = middle[i];
                for (var j = 0; j < period; j++) {
                    var diff = closes[i - j] - mean;
                    sumSq += diff * diff;
                }
                var std = Math.sqrt(sumSq / period);
                upper.push(mean + stdDev * std);
                lower.push(mean - stdDev * std);
            }
        }
        
        return {
            middle: middle,
            upper: upper,
            lower: lower
        };
    }
};

var ChartManager = function(candlestickEl, volumeEl) {
    var self = this;
    self.candlestickChart = echarts.init(candlestickEl, 'dark');
    self.allTicks = [];
    self.candles = [];
    self.intervalMs = 5000;
    self.maxCandles = 500;
    self.downsamplingThreshold = 300;
    self.downsampleInterval = 1;
    self.lastCandleTime = null;
    self.currentPrice = 0;
    self.openPrice = 0;
    self.isInitialized = false;
    
    self.indicators = {
        sma: {
            enabled: false,
            params: { period: 20 },
            color: '#ffd700'
        },
        ema: {
            enabled: false,
            params: { period: 20 },
            color: '#ff69b4'
        },
        macd: {
            enabled: false,
            params: { fast: 12, slow: 26, signal: 9 },
            color: '#00bfff',
            inOwnPanel: true
        },
        rsi: {
            enabled: false,
            params: { period: 14 },
            color: '#da70d6',
            inOwnPanel: true
        },
        bollinger: {
            enabled: false,
            params: { period: 20, stdDev: 2 },
            color: '#9370db'
        }
    };
    
    self._initCharts = function() {
        self._buildChartOption();
    };
    
    self._getActivePanelIndicators = function() {
        var mainPanel = [];
        var subPanels = [];
        
        if (self.indicators.sma.enabled) mainPanel.push('sma');
        if (self.indicators.ema.enabled) mainPanel.push('ema');
        if (self.indicators.bollinger.enabled) mainPanel.push('bollinger');
        if (self.indicators.macd.enabled) subPanels.push('macd');
        if (self.indicators.rsi.enabled) subPanels.push('rsi');
        
        return { mainPanel: mainPanel, subPanels: subPanels };
    };
    
    self._buildChartOption = function() {
        var panels = self._getActivePanelIndicators();
        var totalGrids = 2 + panels.subPanels.length;
        
        var grids = [];
        var xAxes = [];
        var yAxes = [];
        var series = [];
        
        var gridConfig = self._calculateGridLayout(totalGrids);
        
        for (var i = 0; i < totalGrids; i++) {
            grids.push(gridConfig.grids[i]);
            
            var xAxis = {
                type: 'category',
                gridIndex: i,
                data: [],
                axisLine: { lineStyle: { color: '#30363d' } },
                axisLabel: { 
                    color: '#8b949e', 
                    fontSize: 10,
                    show: i === 0 || i === totalGrids - 1 ? true : false
                },
                splitLine: { show: false },
                boundaryGap: true
            };
            xAxes.push(xAxis);
            
            var yAxis = {
                type: 'value',
                scale: true,
                gridIndex: i,
                splitLine: { lineStyle: { color: '#21262d' } },
                axisLine: { lineStyle: { color: '#30363d' } },
                axisLabel: { color: '#8b949e', fontSize: 10 },
                position: 'left'
            };
            
            if (i === 2 && panels.subPanels[0] === 'rsi') {
                yAxis.min = 0;
                yAxis.max = 100;
            }
            
            yAxes.push(yAxis);
        }
        
        series.push({
            name: 'K线',
            type: 'candlestick',
            xAxisIndex: 0,
            yAxisIndex: 0,
            data: [],
            itemStyle: {
                color: '#3fb950',
                color0: '#f85149',
                borderColor: '#3fb950',
                borderColor0: '#f85149'
            }
        });
        
        if (self.indicators.sma.enabled) {
            series.push({
                name: 'SMA',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: [],
                lineStyle: { color: self.indicators.sma.color, width: 1 },
                symbol: 'none',
                smooth: false
            });
        }
        
        if (self.indicators.ema.enabled) {
            series.push({
                name: 'EMA',
                type: 'line',
                xAxisIndex: 0,
                yAxisIndex: 0,
                data: [],
                lineStyle: { color: self.indicators.ema.color, width: 1 },
                symbol: 'none',
                smooth: false
            });
        }
        
        if (self.indicators.bollinger.enabled) {
            series.push(
                {
                    name: '布林上轨',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: [],
                    lineStyle: { color: self.indicators.bollinger.color, width: 1 },
                    symbol: 'none',
                    smooth: false
                },
                {
                    name: '布林中轨',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: [],
                    lineStyle: { color: self.indicators.bollinger.color, width: 1, type: 'dashed' },
                    symbol: 'none',
                    smooth: false
                },
                {
                    name: '布林下轨',
                    type: 'line',
                    xAxisIndex: 0,
                    yAxisIndex: 0,
                    data: [],
                    lineStyle: { color: self.indicators.bollinger.color, width: 1 },
                    symbol: 'none',
                    smooth: false
                }
            );
        }
        
        series.push({
            name: '成交量',
            type: 'bar',
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: [],
            itemStyle: {
                color: function(params) {
                    var idx = params.dataIndex;
                    return params.data && params.data[1] < 0 ? '#f85149' : '#3fb950';
                }
            }
        });
        
        var currentGridIndex = 2;
        if (self.indicators.macd.enabled) {
            series.push(
                {
                    name: 'MACD',
                    type: 'line',
                    xAxisIndex: currentGridIndex,
                    yAxisIndex: currentGridIndex,
                    data: [],
                    lineStyle: { color: '#00bfff', width: 1 },
                    symbol: 'none'
                },
                {
                    name: 'Signal',
                    type: 'line',
                    xAxisIndex: currentGridIndex,
                    yAxisIndex: currentGridIndex,
                    data: [],
                    lineStyle: { color: '#ffa500', width: 1 },
                    symbol: 'none'
                },
                {
                    name: 'Histogram',
                    type: 'bar',
                    xAxisIndex: currentGridIndex,
                    yAxisIndex: currentGridIndex,
                    data: [],
                    itemStyle: {
                        color: function(params) {
                            return params.data && params.data[1] >= 0 ? '#3fb950' : '#f85149';
                        }
                    }
                }
            );
            currentGridIndex++;
        }
        
        if (self.indicators.rsi.enabled) {
            series.push({
                name: 'RSI',
                type: 'line',
                xAxisIndex: currentGridIndex,
                yAxisIndex: currentGridIndex,
                data: [],
                lineStyle: { color: '#da70d6', width: 1.5 },
                symbol: 'none',
                markLine: {
                    silent: true,
                    symbol: 'none',
                    lineStyle: { color: '#484f58', type: 'dashed' },
                    data: [
                        { yAxis: 30, lineStyle: { color: '#f85149', type: 'dashed' } },
                        { yAxis: 70, lineStyle: { color: '#3fb950', type: 'dashed' } }
                    ]
                }
            });
        }
        
        var option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                backgroundColor: '#21262d',
                borderColor: '#30363d',
                textStyle: { color: '#e6edf3' }
            },
            axisPointer: { link: [{ xAxisIndex: 'all' }] },
            grid: grids,
            xAxis: xAxes,
            yAxis: yAxes,
            series: series,
            legend: {
                show: true,
                top: 0,
                textStyle: { color: '#8b949e', fontSize: 10 },
                selectedMode: true
            }
        };
        
        self.candlestickChart.setOption(option, true);
    };
    
    self._calculateGridLayout = function(totalGrids) {
        var grids = [];
        var spacing = 2;
        var availableHeight = 100 - (totalGrids - 1) * spacing;
        
        var mainPanelHeight = 45;
        var volumeHeight = 15;
        var remainingHeight = availableHeight - mainPanelHeight - volumeHeight;
        var subPanelCount = totalGrids - 2;
        var subPanelHeight = subPanelCount > 0 ? remainingHeight / subPanelCount : 0;
        
        grids.push({ left: '60px', right: '20px', top: '30px', height: mainPanelHeight + '%' });
        
        var currentTop = 30 + mainPanelHeight + spacing;
        grids.push({ left: '60px', right: '20px', top: currentTop + '%', height: volumeHeight + '%' });
        currentTop += volumeHeight + spacing;
        
        for (var i = 0; i < subPanelCount; i++) {
            grids.push({ left: '60px', right: '20px', top: currentTop + '%', height: subPanelHeight + '%' });
            currentTop += subPanelHeight + spacing;
        }
        
        return { grids: grids };
    };
    
    self._calculateIndicators = function(displayCandles) {
        var closes = displayCandles.map(function(c) { return c.close; });
        var result = {};
        
        if (self.indicators.sma.enabled) {
            result.sma = TechnicalIndicators.SMA(closes, self.indicators.sma.params.period);
        }
        
        if (self.indicators.ema.enabled) {
            result.ema = TechnicalIndicators.EMA(closes, self.indicators.ema.params.period);
        }
        
        if (self.indicators.macd.enabled) {
            result.macd = TechnicalIndicators.MACD(
                closes,
                self.indicators.macd.params.fast,
                self.indicators.macd.params.slow,
                self.indicators.macd.params.signal
            );
        }
        
        if (self.indicators.rsi.enabled) {
            result.rsi = TechnicalIndicators.RSI(closes, self.indicators.rsi.params.period);
        }
        
        if (self.indicators.bollinger.enabled) {
            result.bollinger = TechnicalIndicators.BollingerBands(
                closes,
                self.indicators.bollinger.params.period,
                self.indicators.bollinger.params.stdDev
            );
        }
        
        return result;
    };
    
    self.setInterval = function(ms) {
        self.intervalMs = ms;
        self.candles = [];
        self.volumeData = [];
        self.lastCandleTime = null;
        self.downsampleInterval = 1;
        self._rebuildFromTicks();
        self._buildChartOption();
        self._updateCharts();
    };
    
    self.toggleIndicator = function(name, enabled) {
        if (self.indicators[name]) {
            self.indicators[name].enabled = enabled;
            self._buildChartOption();
            self._updateCharts();
        }
    };
    
    self.setIndicatorParams = function(name, params) {
        if (self.indicators[name]) {
            for (var key in params) {
                if (params.hasOwnProperty(key)) {
                    self.indicators[name].params[key] = params[key];
                }
            }
            if (self.indicators[name].enabled) {
                self._updateCharts();
            }
        }
    };
    
    self.getIndicatorConfig = function() {
        var config = {};
        for (var name in self.indicators) {
            if (self.indicators.hasOwnProperty(name)) {
                config[name] = {
                    enabled: self.indicators[name].enabled,
                    params: JSON.parse(JSON.stringify(self.indicators[name].params))
                };
            }
        }
        return config;
    };
    
    self._rebuildFromTicks = function() {
        if (self.allTicks.length === 0) return;
        
        var firstTick = self.allTicks[0];
        var candleStartTime = self._alignToInterval(firstTick.timestamp);
        
        var currentCandle = self._createCandle(candleStartTime);
        
        for (var i = 0; i < self.allTicks.length; i++) {
            var tick = self.allTicks[i];
            self._updateCandleFromTick(currentCandle, tick);
            
            if (tick.timestamp >= candleStartTime + self.intervalMs) {
                self.candles.push(currentCandle);
                candleStartTime = self._alignToInterval(tick.timestamp);
                currentCandle = self._createCandle(candleStartTime);
                self._updateCandleFromTick(currentCandle, tick);
            }
        }
        self.lastCandleTime = candleStartTime;
    };
    
    self._alignToInterval = function(timestamp) {
        return Math.floor(timestamp / self.intervalMs) * self.intervalMs;
    };
    
    self._createCandle = function(startTime) {
        return {
            time: startTime,
            open: null,
            high: -Infinity,
            low: Infinity,
            close: null,
            volume: 0
        };
    };
    
    self._updateCandleFromTick = function(candle, tick) {
        if (candle.open === null) candle.open = tick.price;
        candle.close = tick.price;
        if (tick.price > candle.high) candle.high = tick.price;
        if (tick.price < candle.low) candle.low = tick.price;
        candle.volume += tick.quantity;
    };
    
    self._checkDownsampling = function() {
        if (self.candles.length > self.downsamplingThreshold) {
            self.downsampleInterval = Math.ceil(self.candles.length / self.maxCandles);
        } else {
            self.downsampleInterval = 1;
        }
    };
    
    self._isValidCandle = function(candle) {
        return candle && 
               candle.open !== null && 
               candle.close !== null && 
               isFinite(candle.high) && 
               isFinite(candle.low) &&
               candle.high >= candle.low;
    };
    
    self._getDisplayData = function() {
        if (self.downsampleInterval <= 1 || self.candles.length === 0) {
            return self.candles.filter(function(c) { return self._isValidCandle(c); });
        }
        
        var merged = [];
        for (var i = 0; i < self.candles.length; i += self.downsampleInterval) {
            var slice = self.candles.slice(i, i + self.downsampleInterval);
            var validCandles = slice.filter(function(c) { return self._isValidCandle(c); });
            
            if (validCandles.length === 0) continue;
            
            var highs = validCandles.map(function(c) { return c.high; });
            var lows = validCandles.map(function(c) { return c.low; });
            
            var mergedCandle = {
                time: validCandles[0].time,
                open: validCandles[0].open,
                high: Math.max.apply(Math, highs),
                low: Math.min.apply(Math, lows),
                close: validCandles[validCandles.length - 1].close,
                volume: validCandles.reduce(function(sum, c) { return sum + c.volume; }, 0)
            };
            merged.push(mergedCandle);
        }
        return merged;
    };
    
    self.addTick = function(tick) {
        self.allTicks.push(tick);
        if (self.allTicks.length > 50000) {
            self.allTicks = self.allTicks.slice(-30000);
        }
        
        self.currentPrice = tick.price;
        if (!self.isInitialized) {
            self.openPrice = tick.price;
            self.isInitialized = true;
        }
        
        var alignedTime = self._alignToInterval(tick.timestamp);
        
        if (self.lastCandleTime === null || alignedTime !== self.lastCandleTime) {
            if (self.lastCandleTime !== null) {
                self._checkDownsampling();
            }
            var newCandle = self._createCandle(alignedTime);
            self._updateCandleFromTick(newCandle, tick);
            self.candles.push(newCandle);
            self.lastCandleTime = alignedTime;
            
            if (self.candles.length > 2000) {
                self.candles = self.candles.slice(-1500);
            }
        } else if (self.candles.length > 0) {
            var last = self.candles[self.candles.length - 1];
            self._updateCandleFromTick(last, tick);
        }
        
        self._updateCharts();
    };
    
    self._formatTime = function(ms) {
        var d = new Date(ms);
        var h = String(d.getHours()).padStart(2, '0');
        var m = String(d.getMinutes()).padStart(2, '0');
        var s = String(d.getSeconds()).padStart(2, '0');
        return h + ':' + m + ':' + s;
    };
    
    self._updateCharts = function() {
        var displayCandles = self._getDisplayData();
        if (displayCandles.length === 0) return;
        
        var xData = displayCandles.map(function(c) { return self._formatTime(c.time); });
        var candleData = displayCandles.map(function(c) { 
            return [c.open, c.close, c.low, c.high]; 
        });
        
        var volumeData = displayCandles.map(function(c, i) {
            var isUp = i === 0 ? c.close >= c.open : c.close >= displayCandles[i - 1].close;
            return [xData[i], isUp ? c.volume : -c.volume];
        });
        
        var indicators = self._calculateIndicators(displayCandles);
        var seriesUpdates = [];
        
        seriesUpdates.push({ data: candleData });
        var seriesIndex = 1;
        
        if (self.indicators.sma.enabled && indicators.sma) {
            var smaData = indicators.sma.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            seriesUpdates.push({ data: smaData });
            seriesIndex++;
        }
        
        if (self.indicators.ema.enabled && indicators.ema) {
            var emaData = indicators.ema.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            seriesUpdates.push({ data: emaData });
            seriesIndex++;
        }
        
        if (self.indicators.bollinger.enabled && indicators.bollinger) {
            var upperData = indicators.bollinger.upper.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            var middleData = indicators.bollinger.middle.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            var lowerData = indicators.bollinger.lower.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            seriesUpdates.push({ data: upperData });
            seriesUpdates.push({ data: middleData });
            seriesUpdates.push({ data: lowerData });
            seriesIndex += 3;
        }
        
        seriesUpdates.push({ data: volumeData });
        seriesIndex++;
        
        if (self.indicators.macd.enabled && indicators.macd) {
            var macdData = indicators.macd.macd.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            var signalData = indicators.macd.signal.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            var histData = indicators.macd.histogram.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            seriesUpdates.push({ data: macdData });
            seriesUpdates.push({ data: signalData });
            seriesUpdates.push({ data: histData });
            seriesIndex += 3;
        }
        
        if (self.indicators.rsi.enabled && indicators.rsi) {
            var rsiData = indicators.rsi.map(function(v, i) {
                return v === null ? [xData[i], '-'] : [xData[i], v];
            });
            seriesUpdates.push({ data: rsiData });
        }
        
        var option = {
            xAxis: [],
            series: seriesUpdates
        };
        
        var panels = self._getActivePanelIndicators();
        var totalGrids = 2 + panels.subPanels.length;
        
        for (var g = 0; g < totalGrids; g++) {
            option.xAxis.push({ data: xData });
        }
        
        self.candlestickChart.setOption(option);
    };
    
    self.getStats = function() {
        var change = self.openPrice > 0 ? ((self.currentPrice - self.openPrice) / self.openPrice * 100) : 0;
        return {
            currentPrice: self.currentPrice,
            priceChange: change,
            candleCount: self.candles.length,
            tickCount: self.allTicks.length,
            downsampleInterval: self.downsampleInterval
        };
    };
    
    self.dispose = function() {
        self.candlestickChart.dispose();
    };
    
    self._initCharts();
    
    window.addEventListener('resize', function() {
        self.candlestickChart.resize();
    });
};
