<template>
  <div class="query-detail">
    <el-button @click="goBack" style="margin-bottom: 20px">
      <el-icon><ArrowLeft /></el-icon>
      Back
    </el-button>
    
    <el-row :gutter="20">
      <el-col :span="24">
        <el-card>
          <template #header>
            <span>Query Details</span>
          </template>
          
          <div class="query-info">
            <div class="info-row">
              <label>SQL Statement:</label>
              <div class="sql-content">{{ query?.sql }}</div>
            </div>
            <el-row :gutter="20">
              <el-col :span="8">
                <div class="info-item">
                  <label>Duration:</label>
                  <el-tag type="danger" size="large">{{ query?.duration_ms?.toFixed(2) }} ms</el-tag>
                </div>
              </el-col>
              <el-col :span="8">
                <div class="info-item">
                  <label>Database:</label>
                  <span>{{ query?.database || 'N/A' }}</span>
                </div>
              </el-col>
              <el-col :span="8">
                <div class="info-item">
                  <label>Time:</label>
                  <span>{{ formatDate(query?.timestamp) }}</span>
                </div>
              </el-col>
            </el-row>
          </div>
        </el-card>
      </el-col>
    </el-row>
    
    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>Kernel Metrics</span>
          </template>
          <div ref="metricsChartRef" class="chart"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>
            <span>Flame Graph</span>
          </template>
          <div ref="flameGraphRef" class="flame-chart"></div>
        </el-card>
      </el-col>
    </el-row>
    
    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="24">
        <el-card>
          <template #header>
            <span>Metrics Breakdown</span>
          </template>
          <el-descriptions :column="4" border>
            <el-descriptions-item label="IO Read Bytes">{{ metrics?.io_read_bytes || 0 }}</el-descriptions-item>
            <el-descriptions-item label="IO Write Bytes">{{ metrics?.io_write_bytes || 0 }}</el-descriptions-item>
            <el-descriptions-item label="Page Cache Hit Rate">{{ (metrics?.page_cache_hit_rate || 0).toFixed(2) }}%</el-descriptions-item>
            <el-descriptions-item label="Lock Wait Time">{{ (metrics?.lock_wait_time_ms || 0).toFixed(2) }} ms</el-descriptions-item>
            <el-descriptions-item label="TCP TX Bytes">{{ metrics?.tcp_tx_bytes || 0 }}</el-descriptions-item>
            <el-descriptions-item label="TCP RX Bytes">{{ metrics?.tcp_rx_bytes || 0 }}</el-descriptions-item>
            <el-descriptions-item label="Memory Allocated">{{ metrics?.mem_alloc_bytes || 0 }}</el-descriptions-item>
            <el-descriptions-item label="Lock Count">{{ metrics?.lock_count || 0 }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import axios from 'axios'

const route = useRoute()
const router = useRouter()
const metricsChartRef = ref(null)
const flameGraphRef = ref(null)
const query = ref(null)
const metrics = ref(null)

const goBack = () => {
  router.push('/queries')
}

const formatDate = (date) => {
  if (!date) return '-'
  return new Date(date).toLocaleString()
}

const initMetricsChart = () => {
  const chart = echarts.init(metricsChartRef.value)
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['IO Read', 'IO Write', 'Lock Wait'] },
    xAxis: { type: 'category', data: ['T1', 'T2', 'T3', 'T4', 'T5'] },
    yAxis: { type: 'value' },
    series: [
      { name: 'IO Read', type: 'line', data: [120, 200, 150, 80, 70] },
      { name: 'IO Write', type: 'line', data: [60, 120, 90, 140, 110] },
      { name: 'Lock Wait', type: 'bar', data: [20, 35, 25, 40, 30] }
    ]
  }
  chart.setOption(option)
}

const initFlameGraph = () => {
  const chart = echarts.init(flameGraphRef.value)
  const option = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'treemap',
      data: [
        {
          name: 'mysqld',
          value: 1000,
          children: [
            {
              name: 'do_command',
              value: 600,
              children: [
                { name: 'dispatch_command', value: 400 },
                { name: 'parse_sql', value: 150 },
                { name: 'open_tables', value: 50 }
              ]
            },
            {
              name: 'JOIN::exec',
              value: 200,
              children: [
                { name: 'sub_select', value: 120 },
                { name: 'filesort', value: 80 }
              ]
            },
            { name: 'sys_call', value: 200 }
          ]
        }
      ],
      label: { show: true, formatter: '{b}' },
      upperLabel: { show: true, height: 30 },
      roam: false,
      visualMin: 0,
      visualDimension: 1,
      colorSaturation: [0.35, 0.6],
      levels: [
        { itemStyle: { borderColor: '#777', borderWidth: 2, gapWidth: 2 } },
        { colorSaturation: [0.35, 0.6], itemStyle: { borderColorSaturation: 0.7, borderWidth: 2, gapWidth: 1 } },
        { colorSaturation: [0.35, 0.6], itemStyle: { borderColorSaturation: 0.6, borderWidth: 1, gapWidth: 1 } }
      ]
    }]
  }
  chart.setOption(option)
}

const loadData = async () => {
  try {
    const res = await axios.get(`/api/queries/${route.params.id}`)
    query.value = res.data.query
    metrics.value = res.data.metrics
    
    await nextTick()
    initMetricsChart()
    initFlameGraph()
  } catch (error) {
    console.error('Failed to load query detail:', error)
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.query-detail {
  height: 100%;
}

.query-info {
  padding: 10px 0;
}

.info-row {
  margin-bottom: 20px;
}

.info-row label {
  display: block;
  font-weight: 600;
  margin-bottom: 8px;
  color: #2c3e50;
}

.sql-content {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item label {
  font-weight: 600;
  color: #2c3e50;
}

.chart, .flame-chart {
  height: 350px;
  width: 100%;
}
</style>
