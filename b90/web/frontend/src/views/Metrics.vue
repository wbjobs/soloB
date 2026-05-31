<template>
  <div class="metrics-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>System Metrics</span>
          <el-select v-model="timeRange" placeholder="Select time range" style="width: 150px">
            <el-option label="Last 5 min" value="5m" />
            <el-option label="Last 30 min" value="30m" />
            <el-option label="Last 1 hour" value="1h" />
            <el-option label="Last 6 hours" value="6h" />
          </el-select>
        </div>
      </template>
      
      <el-row :gutter="20">
        <el-col :span="12">
          <div class="chart-container">
            <h4>IO Throughput</h4>
            <div ref="ioChartRef" class="chart"></div>
          </div>
        </el-col>
        <el-col :span="12">
          <div class="chart-container">
            <h4>Memory Usage</h4>
            <div ref="memChartRef" class="chart"></div>
          </div>
        </el-col>
      </el-row>
      
      <el-row :gutter="20" style="margin-top: 20px">
        <el-col :span="12">
          <div class="chart-container">
            <h4>Network Traffic</h4>
            <div ref="netChartRef" class="chart"></div>
          </div>
        </el-col>
        <el-col :span="12">
          <div class="chart-container">
            <h4>Lock Contention</h4>
            <div ref="lockChartRef" class="chart"></div>
          </div>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import * as echarts from 'echarts'

const timeRange = ref('1h')
const ioChartRef = ref(null)
const memChartRef = ref(null)
const netChartRef = ref(null)
const lockChartRef = ref(null)

const initIOChart = () => {
  const chart = echarts.init(ioChartRef.value)
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Read (MB/s)', 'Write (MB/s)'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] },
    yAxis: { type: 'value' },
    series: [
      { name: 'Read (MB/s)', type: 'line', smooth: true, data: [45, 52, 38, 65, 58, 72, 48], areaStyle: { opacity: 0.3 } },
      { name: 'Write (MB/s)', type: 'line', smooth: true, data: [20, 25, 18, 32, 28, 35, 22], areaStyle: { opacity: 0.3 } }
    ]
  }
  chart.setOption(option)
}

const initMemChart = () => {
  const chart = echarts.init(memChartRef.value)
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Allocated (MB)', 'Free (MB)'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] },
    yAxis: { type: 'value' },
    series: [
      { name: 'Allocated (MB)', type: 'line', smooth: true, data: [1024, 1152, 1088, 1280, 1216, 1344, 1152], areaStyle: { opacity: 0.3 } },
      { name: 'Free (MB)', type: 'line', smooth: true, data: [512, 384, 448, 256, 320, 192, 384], areaStyle: { opacity: 0.3 } }
    ]
  }
  chart.setOption(option)
}

const initNetChart = () => {
  const chart = echarts.init(netChartRef.value)
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['TX (KB/s)', 'RX (KB/s)'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] },
    yAxis: { type: 'value' },
    series: [
      { name: 'TX (KB/s)', type: 'line', smooth: true, data: [256, 320, 288, 384, 352, 448, 320], areaStyle: { opacity: 0.3 } },
      { name: 'RX (KB/s)', type: 'line', smooth: true, data: [128, 160, 144, 192, 176, 224, 160], areaStyle: { opacity: 0.3 } }
    ]
  }
  chart.setOption(option)
}

const initLockChart = () => {
  const chart = echarts.init(lockChartRef.value)
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Wait Time (ms)', 'Lock Count'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] },
    yAxis: [
      { type: 'value', name: 'Wait Time (ms)' },
      { type: 'value', name: 'Lock Count', position: 'right' }
    ],
    series: [
      { name: 'Wait Time (ms)', type: 'line', smooth: true, data: [5, 8, 6, 12, 10, 15, 7], yAxisIndex: 0 },
      { name: 'Lock Count', type: 'bar', data: [120, 180, 150, 220, 200, 250, 160], yAxisIndex: 1 }
    ]
  }
  chart.setOption(option)
}

onMounted(async () => {
  await nextTick()
  initIOChart()
  initMemChart()
  initNetChart()
  initLockChart()
})
</script>

<style scoped>
.metrics-page {
  height: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-container h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 14px;
}

.chart {
  height: 280px;
  width: 100%;
}
</style>
