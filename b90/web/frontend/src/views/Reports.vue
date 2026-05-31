<template>
  <div class="reports-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Diagnostic Reports</span>
          <el-button type="primary" @click="showGenerateDialog = true">
            <el-icon><DocumentAdd /></el-icon>
            Generate Report
          </el-button>
        </div>
      </template>
      
      <el-table :data="reports" style="width: 100%">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column label="Time Range" width="250">
          <template #default="{ row }">
            {{ formatDate(row.start_time) }} - {{ formatDate(row.end_time) }}
          </template>
        </el-table-column>
        <el-table-column label="Summary" min-width="300">
          <template #default="{ row }">
            <div class="summary-item">
              <span>Total Queries: {{ row.total_queries }}</span>
              <el-divider direction="vertical" />
              <span>Slow Queries: {{ row.slow_queries }}</span>
              <el-divider direction="vertical" />
              <span>Avg Duration: {{ row.avg_duration?.toFixed(2) }} ms</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="Generated At" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="Actions" width="200">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="viewReport(row)">
              View
            </el-button>
            <el-button type="success" link size="small" @click="downloadPDF(row)">
              Download PDF
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    
    <el-dialog v-model="showGenerateDialog" title="Generate Diagnostic Report" width="500px">
      <el-form :model="reportForm" label-width="120px">
        <el-form-item label="Start Date">
          <el-date-picker v-model="reportForm.start_date" type="date" placeholder="Select start date" style="width: 100%" />
        </el-form-item>
        <el-form-item label="End Date">
          <el-date-picker v-model="reportForm.end_date" type="date" placeholder="Select end date" style="width: 100%" />
        </el-form-item>
        <el-form-item label="Include">
          <el-checkbox-group v-model="reportForm.include">
            <el-checkbox label="query_stats" label="Query Statistics" />
            <el-checkbox label="kernel_metrics" label="Kernel Metrics" />
            <el-checkbox label="recommendations" label="Optimization Recommendations" />
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerateDialog = false">Cancel</el-button>
        <el-button type="primary" @click="generateReport" :loading="generating">Generate</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { DocumentAdd } from '@element-plus/icons-vue'
import axios from 'axios'

const showGenerateDialog = ref(false)
const generating = ref(false)
const reports = ref([])

const reportForm = reactive({
  start_date: '',
  end_date: '',
  include: ['query_stats', 'kernel_metrics', 'recommendations']
})

const formatDate = (date) => {
  if (!date) return '-'
  return new Date(date).toLocaleString()
}

const generateReport = async () => {
  generating.value = true
  try {
    const res = await axios.post('/api/reports/generate', {
      start_date: reportForm.start_date?.toISOString().split('T')[0],
      end_date: reportForm.end_date?.toISOString().split('T')[0]
    })
    
    reports.value.unshift(res.data)
    showGenerateDialog.value = false
    ElMessage.success('Report generated successfully!')
  } catch (error) {
    console.error('Failed to generate report:', error)
    ElMessage.error('Failed to generate report')
  } finally {
    generating.value = false
  }
}

const viewReport = (row) => {
  console.log('View report:', row)
}

const downloadPDF = async (row) => {
  try {
    const link = document.createElement('a')
    link.href = `data:application/pdf;base64,JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDEgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgMiAwIFI+Pj4+L0NvbnRlbnRzIDQgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZS9Gb250L1N1YnR5cGUvVHlwZTEvQmFzZUZvbnQvSGVsdmV0aWNhPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQ0Pj4Kc3RyZWFtCkJUCi9GMSAxOCBUZgo1MCA3MDAgVGQKKFBCUyBGcm9udGVuZCBEaWFnbm9zdGljIFJlcG9ydCkgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagoxIDAgb2JqCjw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+CmVuZG9iago1IDAgb2JqCjw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAxIDAgUj4+CmVuZG9iago2IDAgb2JqCjw8L1Byb2R1Y2VyKFBERiBwcm9kdWNlZCBieSBEQiBQcm9maWxlcik+PgplbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwNDEyIDAwMDAwIG4gCjAwMDAwMDAyODEgMDAwMDAgbiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMzQxIDAwMDAwIG4gCjAwMDAwMDA0NTcgMDAwMDAgbiAKMDAwMDAwMDUwMiAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNy9Sb290IDUgMCBSL0luZm8gNiAwIFI+PgpzdGFydHhyZWYKNTg5CiUlRU9G`
    link.download = `db-profiler-report-${row.id}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    ElMessage.success('PDF download started!')
  } catch (error) {
    console.error('Failed to download PDF:', error)
    ElMessage.error('Failed to download PDF')
  }
}

onMounted(() => {
  reports.value = [
    { id: 1, start_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), end_time: new Date(), total_queries: 15234, slow_queries: 127, avg_duration: 185.5, created_at: new Date() },
    { id: 2, start_time: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), end_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), total_queries: 12456, slow_queries: 98, avg_duration: 156.2, created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    { id: 3, start_time: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), end_time: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), total_queries: 28765, slow_queries: 234, avg_duration: 210.8, created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
  ]
})
</script>

<style scoped>
.reports-page {
  height: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.summary-item {
  display: flex;
  align-items: center;
  font-size: 13px;
}
</style>
