<template>
    <div class="candlestick-container">
        <div ref="chartRef" class="chart"></div>
    </div>
</template>

<script>
const { ref, onMounted, onUnmounted, watch, defineEmits } = Vue;

export default {
    name: 'CandlestickChart',
    props: {
        ticks: {
            type: Array,
            default: () => []
        },
        intervalMs: {
            type: Number,
            default: 5000
        },
        maxCandles: {
            type: Number,
            default: 500
        }
    },
    setup(props) {
        const chartRef = ref(null);
        let chart = null;
        let localChartManager = null;
        const emit = defineEmits(['stats-update']);

        const initChart = () => {
            chart = echarts.init(chartRef.value, 'dark');
            
            const commonAxis = {
                type: 'category',
                axisLine: { lineStyle: { color: '#30363d' } },
                axisLabel: { color: '#8b949e', fontSize: 10 },
                splitLine: { show: false },
                boundaryGap: true
            };

            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    axisPointer: { type: 'cross' },
                    backgroundColor: '#21262d',
                    borderColor: '#30363d',
                    textStyle: { color: '#e6edf3' }
                },
                axisPointer: { link: [{ xAxisIndex: 'all' }] },
                grid: [
                    { left: '60px', right: '20px', top: '20px', bottom: '40px' },
                    { left: '60px', right: '20px', top: '55%', bottom: '5%' }
                ],
                xAxis: [
                    { ...commonAxis, gridIndex: 0, data: [] },
                    { ...commonAxis, gridIndex: 1, data: [] }
                ],
                yAxis: [
                    {
                        type: 'value',
                        scale: true,
                        gridIndex: 0,
                        splitLine: { lineStyle: { color: '#21262d' } },
                        axisLine: { lineStyle: { color: '#30363d' } },
                        axisLabel: { color: '#8b949e', fontSize: 10 }
                    },
                    {
                        type: 'value',
                        scale: true,
                        gridIndex: 1,
                        splitLine: { show: false },
                        axisLine: { lineStyle: { color: '#30363d' } },
                        axisLabel: { color: '#8b949e', fontSize: 10 }
                    }
                ],
                series: [
                    {
                        name: 'K线',
                        type: 'candlestick',
                        data: [],
                        itemStyle: {
                            color: '#3fb950',
                            color0: '#f85149',
                            borderColor: '#3fb950',
                            borderColor0: '#f85149'
                        }
                    },
                    {
                        name: '成交量',
                        type: 'bar',
                        xAxisIndex: 1,
                        yAxisIndex: 1,
                        data: [],
                        itemStyle: {
                            color: function(params) {
                                return params.data && params.data[1] < 0 ? '#f85149' : '#3fb950';
                            }
                        }
                    }
                ]
            };

            chart.setOption(option);
            window.addEventListener('resize', handleResize);
        };

        const handleResize = () => {
            if (chart) chart.resize();
        };

        const updateChart = (data) => {
            if (!chart || data.candles.length === 0) return;

            const displayCandles = data.displayCandles;
            const xData = displayCandles.map(c => formatTime(c.time));
            const candleData = displayCandles.map(c => [c.open, c.close, c.low, c.high]);
            
            const volumeData = displayCandles.map((c, i) => {
                const isUp = i === 0 ? c.close >= c.open : c.close >= displayCandles[i - 1].close;
                return [xData[i], isUp ? c.volume : -c.volume];
            });

            chart.setOption({
                xAxis: [
                    { data: xData },
                    { data: xData }
                ],
                series: [
                    { data: candleData },
                    { data: volumeData }
                ]
            });
        };

        const formatTime = (ms) => {
            const d = new Date(ms);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        };

        watch(() => props.ticks, (newTicks) => {
            if (newTicks.length === 0) return;
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
            updateChart
        };
    }
};
</script>

<style scoped>
.candlestick-container {
    height: 100%;
    width: 100%;
}
.chart {
    width: 100%;
    height: 100%;
}
</style>
