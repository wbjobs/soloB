<template>
  <div class="dashboard">
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon blue">
              <el-icon><Document /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.totalQueries }}</div>
              <div class="stat-label">Total Slow Queries</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon green">
              <el-icon><Timer /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.avgDuration }}ms</div>
              <div class="stat-label">Avg Duration</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon orange">
              <el-icon><TrendCharts /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.uniqueQueries }}</div>
              <div class="stat-label">Unique Query Patterns</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <div class="stat-content">
            <div class="stat-icon red">
              <el-icon><Warning /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stats.anomalies }}</div>
              <div class="stat-label">Anomalies Detected</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="charts-row">
      <el-col :span="14">
        <el-card class="chart-card">
          <template #header>
            <div class="card-header">
              <span>Query Trend (Last 7 Days)</span>
            </div>
          </template>
          <div ref="trendChartRef" class="chart"></div>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card class="chart-card">
          <template #header>
            <div class="card-header">
              <span>Top 5 Slowest Queries</span>
            </div>
          </template>
          <div ref="topQueriesChartRef" class="chart"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="bottom-row">
      <el-col :span="12">
        <el-card class="chart-card">
          <template #header>
            <div class="card-header">
              <span>Kernel Metrics Correlation</span>
            </div>
          </template>
          <div ref="correlationChartRef" class="chart"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card class="chart-card">
          <template #header>
            <div class="card-header">
              <span>Performance Insights</span>
            </div>
          </template>
          <div class="insights-list">
            <div v-for="(insight, index) in insights" :key="index" class="insight-item">
              <el-icon :class="getInsightIconClass(insight.type)">
                <component :is="getInsightIcon(insight.type)" />
              </el-icon>
              <span>{{ insight.message }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { Document, Timer, TrendCharts, Warning, InfoFilled, CircleCheck } from '@element-plus/icons-vue'
import axios from 'axios'

const trendChartRef = ref(null)
const topQueriesChartRef = ref(null)
const correlationChartRef = ref(null)

const stats = ref({
  totalQueries: 0,
  avgDuration: '0',
  uniqueQueries: 0,
  anomalies: 0
})

const insights = ref([
  { type: 'warning', message: 'High IO latency detected affecting 30% of queries' },
  { type: 'info', message: 'Page cache hit rate below 80% - consider increasing cache size' },
  { type: 'success', message: 'Query optimization recommended for top 5 queries' },
  { type: 'warning', message: 'Lock contention detected in write-heavy operations' }
])

const getInsightIcon = (type) => {
  const icons = {
    warning: Warning,
    info: InfoFilled,
    success: CircleCheck
  }
  return icons[type] || InfoFilled
}

const getInsightIconClass = (type) => {
  const classes = {
    warning: 'text-orange-500',
    info: 'text-blue-500',
    success: 'text-green-500'
  }
  return classes[type] || ''
}

const initCharts = () => {
  const trendChart = echarts.init(trendChartRef.value)
  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Query Count', 'Avg Duration (ms)'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    },
    yAxis: [
      { type: 'value', name: 'Count' },
      { type: 'value', name: 'Duration (ms)', position: 'right' }
    ],
    series: [
      {
        name: 'Query Count',
        type: 'line',
        smooth: true,
        data: [120, 132, 101, 134, 90, 230, 210],
        areaStyle: { opacity: 0.3 }
      },
      {
        name: 'Avg Duration (ms)',
        type: 'bar',
        yAxisIndex: 1,
        data: [150, 220, 180, 250, 190, 380, 320],
        itemStyle: { color: '#ee6666' }
      }
    ]
  }
  trendChart.setOption(trendOption)

  const topQueriesChart = echarts.init(topQueriesChartRef.value)
  const topQueriesOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'value', name: 'Total Time (ms)' },
    yAxis: {
      type: 'category',
      data: ['Query A', 'Query B', 'Query C', 'Query D', 'Query E']
    },
    series: [{
      type: 'bar',
      data: [12500, 9800, 7600, 5400, 3200],
      itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
          { offset: 0, color: '#83bff6' },
          { offset: 0.5, color: '#188df0' },
          { offset: 1, color: '#188df0' }
        ])
      }
    }]
  }
  topQueriesChart.setOption(topQueriesOption)

  const correlationChart = echarts.init(correlationChartRef.value)
  const correlationOption = {
    tooltip: {},
    legend: { data: ['IO Latency', 'Lock Wait', 'Cache Miss'] },
    radar: {
      indicator: [
        { name: 'Query 1', max: 100 },
        { name: 'Query 2', max: 100 },
        { name: 'Query 3', max: 100 },
        { name: 'Query 4', max: 100 },
        { name: 'Query 5', max: 100 }
      ]
    },
    series: [{
      type: 'radar',
      data: [
        { value: [85, 70, 65, 90, 75], name: 'IO Latency' },
        { value: [60, 80, 75, 65, 85], name: 'Lock Wait' },
        { value: [45, 60, 55, 70, 65], name: 'Cache Miss' }
      ]
    }]
  }
  correlationChart.setOption(correlationOption)
}

const loadData = async () => {
  try {
    const [trendsRes, topRes] = await Promise.all([
      axios.get('/api/queries/trends'),
      axios.get('/api/queries/top')
    ])
    
    if (trendsRes.data && trendsRes.data.length > 0) {
      const total = trendsRes.data.reduce((sum, d) => sum + d.count, 0)
      stats.value.totalQueries = total
      stats.value.uniqueQueries = topRes.data?.length || 0
    }
    
    stats.value.avgDuration = '185'
    stats.value.anomalies = 12
  } catch (error) {
    console.error('Failed to load dashboard data:', error)
  }
}

onMounted(async () => {
  await nextTick()
  initCharts()
  loadData()
})
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.stats-row {
  margin-bottom: 10px;
}

.stat-card {
  border-radius: 8px;
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 15px;
}

.stat-icon {
  width: 50px;
  height: 50px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: white;
}

.stat-icon.blue { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.stat-icon.green { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
.stat-icon.orange { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); }
.stat-icon.red { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); }

.stat-value {
  font-size: 24px;
  font-weight: bold;
  color: #2c3e50;
}

.stat-label {
  font-size: 14px;
  color: #7f8c8d;
}

.charts-row, .bottom-row {
  margin-top: 10px;
}

.chart-card {
  border-radius: 8px;
  height: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.chart {
  height: 300px;
  width: 100%;
}

.insights-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.insight-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
  font-size: 14px;
}

.text-orange-500 { color: #f59e0b; }
.text-blue-500 { color: #3b82f6; }
.text-green-500 { color: #10b981; }
</style>
