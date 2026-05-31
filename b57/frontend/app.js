(function() {
    var VueObj = Vue;
    var createApp = VueObj.createApp;
    var ref = VueObj.ref;
    var reactive = VueObj.reactive;
    var onMounted = VueObj.onMounted;
    var onUnmounted = VueObj.onUnmounted;
    var computed = VueObj.computed;
    var watch = VueObj.watch;
    var nextTick = VueObj.nextTick;

    var App = {
        setup: function() {
            var klineChartRef = ref(null);
            var depthChartRef = ref(null);
            var connected = ref(false);
            var currentPrice = ref(60000);
            var priceChange = ref(0);
            var candleCount = ref(0);
            var tickCount = ref(0);
            var downsampleInterval = ref(1);
            var recentTrades = ref([]);
            var depthAsks = ref([]);
            var depthBids = ref([]);

            var askPrice = ref('--');
            var bidPrice = ref('--');
            var spread = ref('--');

            var selectedInterval = ref('5s');
            var intervalOptions = {
                '1s': { label: '1秒', ms: 1000 },
                '5s': { label: '5秒', ms: 5000 },
                '15s': { label: '15秒', ms: 15000 },
                '1m': { label: '1分', ms: 60000 }
            };

            var indicatorList = reactive({
                sma: {
                    enabled: false,
                    label: 'SMA',
                    color: '#ffd700'
                },
                ema: {
                    enabled: false,
                    label: 'EMA',
                    color: '#ff69b4'
                },
                macd: {
                    enabled: false,
                    label: 'MACD',
                    color: '#00bfff'
                },
                rsi: {
                    enabled: false,
                    label: 'RSI',
                    color: '#da70d6'
                },
                bollinger: {
                    enabled: false,
                    label: '布林带',
                    color: '#9370db'
                }
            });

            var indicatorParams = reactive({
                sma: { period: 20 },
                ema: { period: 20 },
                macd: { fast: 12, slow: 26, signal: 9 },
                rsi: { period: 14 },
                bollinger: { period: 20, stdDev: 2 }
            });

            var paramLabels = {
                sma: { period: '周期' },
                ema: { period: '周期' },
                macd: { fast: '快线周期', slow: '慢线周期', signal: '信号线周期' },
                rsi: { period: '周期' },
                bollinger: { period: '周期', stdDev: '标准差倍数' }
            };

            var activeSettingsIndicator = ref(null);

            var chartManager = null;
            var depthChart = null;
            var ws = null;
            var reconnectTimer = null;
            var depthUpdateTimeout = null;

            var orderbookAsks = computed(function() {
                return depthAsks.value.slice().sort(function(a, b) {
                    return a.price - b.price;
                }).slice(0, 15);
            });

            var orderbookBids = computed(function() {
                return depthBids.value.slice().sort(function(a, b) {
                    return b.price - a.price;
                }).slice(0, 15);
            });

            var maxAskQty = computed(function() {
                var qtys = orderbookAsks.value.map(function(o) { return o.quantity; });
                return qtys.length > 0 ? Math.max.apply(Math, qtys) : 1;
            });

            var maxBidQty = computed(function() {
                var qtys = orderbookBids.value.map(function(o) { return o.quantity; });
                return qtys.length > 0 ? Math.max.apply(Math, qtys) : 1;
            });

            var getBarWidth = function(qty, max) {
                return max > 0 ? Math.min(100, (qty / max) * 100) : 0;
            };

            var formatTradeTime = function(ts) {
                var d = new Date(ts);
                var h = String(d.getHours()).padStart(2, '0');
                var m = String(d.getMinutes()).padStart(2, '0');
                var s = String(d.getSeconds()).padStart(2, '0');
                var ms = String(d.getMilliseconds()).padStart(3, '0');
                return h + ':' + m + ':' + s + '.' + ms;
            };

            var changeInterval = function(key) {
                selectedInterval.value = key;
                if (chartManager) {
                    chartManager.setInterval(intervalOptions[key].ms);
                }
            };

            var toggleIndicator = function(name) {
                indicatorList[name].enabled = !indicatorList[name].enabled;
                if (chartManager) {
                    chartManager.toggleIndicator(name, indicatorList[name].enabled);
                    if (indicatorList[name].enabled) {
                        chartManager.setIndicatorParams(name, indicatorParams[name]);
                    }
                }
            };

            var openIndicatorSettings = function(name) {
                activeSettingsIndicator.value = name;
            };

            var closeIndicatorSettings = function() {
                activeSettingsIndicator.value = null;
            };

            var getIndicatorLabel = function(name) {
                return indicatorList[name] ? indicatorList[name].label : name;
            };

            var getParamLabel = function(indicatorName, paramKey) {
                if (paramLabels[indicatorName] && paramLabels[indicatorName][paramKey]) {
                    return paramLabels[indicatorName][paramKey];
                }
                return paramKey;
            };

            var updateIndicatorParam = function(indicatorName, paramKey, event) {
                var value = parseInt(event.target.value);
                if (!isNaN(value) && value > 0) {
                    indicatorParams[indicatorName][paramKey] = value;
                    if (chartManager && indicatorList[indicatorName].enabled) {
                        var params = {};
                        params[paramKey] = value;
                        chartManager.setIndicatorParams(indicatorName, params);
                    }
                }
            };

            var updateDepthChart = function() {
                if (!depthChart) return;

                var asks = depthAsks.value.slice().sort(function(a, b) { return a.price - b.price; });
                var bids = depthBids.value.slice().sort(function(a, b) { return b.price - a.price; });

                if (asks.length > 0 && bids.length > 0) {
                    askPrice.value = asks[0].price.toFixed(2);
                    bidPrice.value = bids[0].price.toFixed(2);
                    spread.value = (asks[0].price - bids[0].price).toFixed(2);
                }

                var askCumVolume = 0;
                var askData = asks.map(function(o) {
                    askCumVolume += o.quantity;
                    return [o.price, askCumVolume];
                });

                var bidCumVolume = 0;
                var bidData = bids.map(function(o) {
                    bidCumVolume += o.quantity;
                    return [o.price, bidCumVolume];
                });

                var allPrices = asks.map(function(o) { return o.price; })
                    .concat(bids.map(function(o) { return o.price; }));
                if (allPrices.length === 0) return;

                var minPrice = Math.min.apply(Math, allPrices) * 0.9995;
                var maxPrice = Math.max.apply(Math, allPrices) * 1.0005;
                var maxVolume = Math.max(askCumVolume, bidCumVolume);

                var option = {
                    backgroundColor: 'transparent',
                    tooltip: {
                        trigger: 'axis',
                        backgroundColor: '#21262d',
                        borderColor: '#30363d',
                        textStyle: { color: '#e6edf3' },
                        formatter: function(params) {
                            if (!params || params.length === 0) return '';
                            var p = params[0];
                            var price = p.value[0];
                            var vol = p.value[1];
                            return '价格: ' + price.toFixed(2) + '<br/>累计量: ' + vol.toFixed(4);
                        }
                    },
                    grid: {
                        left: '60px',
                        right: '20px',
                        top: '20px',
                        bottom: '20px'
                    },
                    xAxis: {
                        type: 'value',
                        min: minPrice,
                        max: maxPrice,
                        axisLine: { lineStyle: { color: '#30363d' } },
                        axisLabel: { color: '#8b949e', fontSize: 10 },
                        splitLine: { lineStyle: { color: '#21262d' } }
                    },
                    yAxis: {
                        type: 'value',
                        min: 0,
                        max: maxVolume,
                        axisLine: { lineStyle: { color: '#30363d' } },
                        axisLabel: { color: '#8b949e', fontSize: 10 },
                        splitLine: { lineStyle: { color: '#21262d' } }
                    },
                    series: [
                        {
                            name: '卖单',
                            type: 'line',
                            smooth: false,
                            step: 'end',
                            data: askData,
                            lineStyle: { color: '#f85149', width: 2 },
                            areaStyle: {
                                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                                    { offset: 0, color: 'rgba(248, 81, 73, 0.05)' },
                                    { offset: 1, color: 'rgba(248, 81, 73, 0.3)' }
                                ])
                            },
                            symbol: 'none'
                        },
                        {
                            name: '买单',
                            type: 'line',
                            smooth: false,
                            step: 'end',
                            data: bidData,
                            lineStyle: { color: '#3fb950', width: 2 },
                            areaStyle: {
                                color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [
                                    { offset: 0, color: 'rgba(63, 185, 80, 0.05)' },
                                    { offset: 1, color: 'rgba(63, 185, 80, 0.3)' }
                                ])
                            },
                            symbol: 'none'
                        }
                    ]
                };

                depthChart.setOption(option);
            };

            var debouncedDepthUpdate = function() {
                if (depthUpdateTimeout) return;
                depthUpdateTimeout = setTimeout(function() {
                    updateDepthChart();
                    depthUpdateTimeout = null;
                }, 50);
            };

            var connectWebSocket = function() {
                var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                var wsUrl = protocol + '//' + window.location.host + '/ws/ticks';

                ws = new WebSocket(wsUrl);

                ws.onopen = function() {
                    connected.value = true;
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                };

                ws.onmessage = function(event) {
                    try {
                        var tick = JSON.parse(event.data);

                        if (chartManager) {
                            chartManager.addTick(tick);
                            var stats = chartManager.getStats();
                            currentPrice.value = stats.currentPrice;
                            priceChange.value = stats.priceChange;
                            candleCount.value = stats.candleCount;
                            tickCount.value = stats.tickCount;
                            downsampleInterval.value = stats.downsampleInterval;
                        }

                        recentTrades.value.unshift(tick);
                        if (recentTrades.value.length > 20) {
                            recentTrades.value = recentTrades.value.slice(0, 20);
                        }

                        depthAsks.value = tick.asks || [];
                        depthBids.value = tick.bids || [];
                        debouncedDepthUpdate();

                    } catch (err) {
                        console.error('Parse error:', err);
                    }
                };

                ws.onclose = function() {
                    connected.value = false;
                    reconnectTimer = setTimeout(function() {
                        connectWebSocket();
                    }, 2000);
                };

                ws.onerror = function(err) {
                    console.error('WebSocket error:', err);
                };
            };

            var initCharts = function() {
                nextTick(function() {
                    if (klineChartRef.value) {
                        chartManager = new ChartManager(klineChartRef.value, null);
                        chartManager.setInterval(intervalOptions[selectedInterval.value].ms);
                    }
                    if (depthChartRef.value) {
                        depthChart = echarts.init(depthChartRef.value, 'dark');
                        window.addEventListener('resize', function() {
                            if (depthChart) depthChart.resize();
                            if (chartManager) chartManager.candlestickChart.resize();
                        });
                    }
                    connectWebSocket();
                });
            };

            onMounted(function() {
                initCharts();
            });

            onUnmounted(function() {
                if (ws) ws.close();
                if (reconnectTimer) clearTimeout(reconnectTimer);
                if (depthUpdateTimeout) clearTimeout(depthUpdateTimeout);
                if (chartManager) chartManager.dispose();
                if (depthChart) depthChart.dispose();
            });

            return {
                klineChartRef: klineChartRef,
                depthChartRef: depthChartRef,
                connected: connected,
                currentPrice: currentPrice,
                priceChange: priceChange,
                candleCount: candleCount,
                tickCount: tickCount,
                downsampleInterval: downsampleInterval,
                recentTrades: recentTrades,
                depthAsks: depthAsks,
                depthBids: depthBids,
                askPrice: askPrice,
                bidPrice: bidPrice,
                spread: spread,
                selectedInterval: selectedInterval,
                intervalOptions: intervalOptions,
                orderbookAsks: orderbookAsks,
                orderbookBids: orderbookBids,
                maxAskQty: maxAskQty,
                maxBidQty: maxBidQty,
                getBarWidth: getBarWidth,
                formatTradeTime: formatTradeTime,
                changeInterval: changeInterval,
                indicatorList: indicatorList,
                indicatorParams: indicatorParams,
                activeSettingsIndicator: activeSettingsIndicator,
                toggleIndicator: toggleIndicator,
                openIndicatorSettings: openIndicatorSettings,
                closeIndicatorSettings: closeIndicatorSettings,
                getIndicatorLabel: getIndicatorLabel,
                getParamLabel: getParamLabel,
                updateIndicatorParam: updateIndicatorParam
            };
        }
    };

    var app = createApp(App);
    app.mount('#app');
})();
