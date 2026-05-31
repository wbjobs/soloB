<template>
  <div class="anomalies-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Anomaly Detection</span>
          <el-button type="primary" @click="detectAnomalies" :loading="detecting">
            <el-icon><Refresh /></el-icon>
            Detect Anomalies
          </el-button>
        </div>
      </template>
      
      <el-alert
        title="Anomaly Detection Engine"
        type="info"
        description="System monitors query patterns, IO latency, lock contention, and cache efficiency to detect performance anomalies."
        :closable="false"
        style="margin-bottom: 20px"
      />
      
      <el-table :data="anomalies" style="width: 100%">
        <el-table-column label="Severity" width="100">
          <template #default="{ row }">
            <el-tag :type="getSeverityType(row.severity)" size="small">
              {{ row.severity }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="event_type" label="Type" width="150" />
        <el-table-column prop="description" label="Description" min-width="300" show-overflow-tooltip />
        <el-table-column label="Correlation" width="120">
          <template #default="{ row }">
            <el-progress
              :percentage="Math.round(row.correlation_score * 100)"
              :color="getCorrelationColor(row.correlation_score)"
              :stroke-width="8"
            />
          </template>
        </el-table-column>
        <el-table-column prop="timestamp" label="Time" width="180">
          <template #default="{ row }">
            {{ formatDate(row.timestamp) }}
          </template>
        </el-table-column>
        <el-table-column label="Actions" width="120">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="viewDetail(row)">
              Analyze
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'

const detecting = ref(false)
const anomalies = ref([])

const getSeverityType = (severity) => {
  const map = { WARNING: 'warning', CRITICAL: 'danger', INFO: 'info' }
  return map[severity] || 'info'
}

const getCorrelationColor = (score) => {
  if (score > 0.8) return '#f56c6c'
  if (score > 0.5) return '#e6a23c'
  return '#67c23a'
}

const formatDate = (date) => {
  if (!date) return '-'
  return new Date(date).toLocaleString()
}

const detectAnomalies = async () => {
  detecting.value = true
  try {
    const res = await axios.get('/api/anomalies/detect')
    anomalies.value = res.data || []
  } catch (error) {
    console.error('Failed to detect anomalies:', error)
  } finally {
    detecting.value = false
  }
}

const viewDetail = (row) => {
  console.log('View anomaly detail:', row)
}

onMounted(() => {
  anomalies.value = [
    { id: 1, severity: 'CRITICAL', event_type: 'HIGH_IO_LATENCY', description: 'Query ID #42 showing abnormal IO latency (> 500ms avg)', correlation_score: 0.92, timestamp: new Date() },
    { id: 2, severity: 'WARNING', event_type: 'LOCK_CONTENTION', description: 'Increased mutex wait time detected in mysqld process', correlation_score: 0.75, timestamp: new Date(Date.now() - 300000) },
    { id: 3, severity: 'WARNING', event_type: 'CACHE_MISS', description: 'Page cache hit rate dropped below 70% for 5 consecutive minutes', correlation_score: 0.68, timestamp: new Date(Date.now() - 600000) },
    { id: 4, severity: 'INFO', event_type: 'QUERY_SPIKE', description: 'Unusual query pattern detected - 3x increase in execution time', correlation_score: 0.45, timestamp: new Date(Date.now() - 900000) },
    { id: 5, severity: 'WARNING', event_type: 'MEMORY_BLOAT', description: 'Increasing memory allocation trend in database process', correlation_score: 0.58, timestamp: new Date(Date.now() - 1200000) }
  ]
})
</script>

<style scoped>
.anomalies-page {
  height: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
