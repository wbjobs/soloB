<template>
    <div class="depth-chart-container">
        <div ref="chartRef" class="chart"></div>
        <div class="spread-info">
            <div class="spread-item">
                <span class="label">卖一价 (Ask)</span>
                <span class="value ask">{{ askPrice }}</span>
            </div>
            <div class="spread-item">
                <span class="label">价差</span>
                <span class="value">{{ spread }}</span>
            </div>
            <div class="spread-item">
                <span class="label">买一价 (Bid)</span>
                <span class="value bid">{{ bidPrice }}</span>
            </div>
        </div>
    </div>
</template>

<script>
const { ref, onMounted, onUnmounted, watch } = Vue;

export default {
    name: 'DepthChart',
    props: {
        asks: {
            type: Array,
            default: () => []
        },
        bids: {
            type: Array,
            default: () => []
        }
    },
    setup(props) {
        const chartRef = ref(null);
        let chart = null;
        const askPrice = ref('--');
        const bidPrice = ref('--');
        const spread = ref('--');

        const initChart = () => {
            chart = echarts.init(chartRef.value, 'dark');
            updateChart();
            window.addEventListener('resize', handleResize);
        };

        const handleResize = () => {
            if (chart) chart.resize();
        };

        const updateChart = () => {
            if (!chart) return;

            const asks = [...props.asks].sort((a, b) => a.price - b.price);
            const bids = [...props.bids].sort((a, b) => b.price - a.price);

            if (asks.length > 0 && bids.length > 0) {
                const ask = asks[0].price;
                const bid = bids[0].price;
                askPrice.value = ask.toFixed(2);
                bidPrice.value = bid.toFixed(2);
                spread.value = (ask - bid).toFixed(2);
            }

            let askCumVolume = 0;
            const askData = asks.map(o => {
                askCumVolume += o.quantity;
                return [o.price, askCumVolume];
            });

            let bidCumVolume = 0;
            const bidData = bids.map(o => {
                bidCumVolume += o.quantity;
                return [o.price, bidCumVolume];
            });

            const allPrices = [...asks.map(o => o.price), ...bids.map(o => o.price)];
            const minPrice = Math.min(...allPrices) * 0.9995;
            const maxPrice = Math.max(...allPrices) * 1.0005;
            const maxVolume = Math.max(askCumVolume, bidCumVolume);

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: '#21262d',
                    borderColor: '#30363d',
                    textStyle: { color: '#e6edf3' },
                    formatter: function(params) {
                        if (!params || params.length === 0) return '';
                        const p = params[0];
                        const price = p.value[0];
                        const vol = p.value[1];
                        return `价格: ${price.toFixed(2)}<br/>累计量: ${vol.toFixed(4)}`;
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
                        name: '卖单 (Asks)',
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
                        name: '买单 (Bids)',
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

            chart.setOption(option);
        };

        watch(() => [props.asks, props.bids], () => {
            updateChart();
        }, { deep: true });

        onMounted(() => {
            initChart();
        });

        onUnmounted(() => {
            window.removeEventListener('resize', handleResize);
            if (chart) chart.dispose();
        });

        return {
            chartRef,
            askPrice,
            bidPrice,
            spread
        };
    }
};
</script>

<style scoped>
.depth-chart-container {
    display: flex;
    flex-direction: column;
    height: 100%;
}
.chart {
    flex: 1;
    min-height: 0;
}
.spread-info {
    display: flex;
    justify-content: space-around;
    padding: 8px 0 0 0;
    border-top: 1px solid #30363d;
    margin-top: 8px;
}
.spread-item {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.spread-item .label {
    font-size: 10px;
    color: #8b949e;
}
.spread-item .value {
    font-size: 13px;
    font-weight: 600;
}
.spread-item .value.ask {
    color: #f85149;
}
.spread-item .value.bid {
    color: #3fb950;
}
</style>
