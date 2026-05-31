<template>
  <div class="queries-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>Slow Query List</span>
          <el-input
            v-model="searchQuery"
            placeholder="Search SQL..."
            style="width: 300px"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
      </template>
      
      <el-table :data="filteredQueries" style="width: 100%" v-loading="loading">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="sql" label="SQL Statement" min-width="300" show-overflow-tooltip />
        <el-table-column prop="database" label="Database" width="120" />
        <el-table-column prop="duration_ms" label="Duration (ms)" width="130" sortable>
          <template #default="{ row }">
            <el-tag :type="getDurationTagType(row.duration_ms)">
              {{ row.duration_ms?.toFixed(2) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="timestamp" label="Time" width="180">
          <template #default="{ row }">
            {{ formatDate(row.timestamp) }}
          </template>
        </el-table-column>
        <el-table-column label="Actions" width="120">
          <template #default="{ row }">
            <el-button type="primary" link @click="viewDetail(row.id)">
              View Detail
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top: 20px; justify-content: flex-end"
      />
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import axios from 'axios'

const router = useRouter()
const searchQuery = ref('')
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const queries = ref([])

const filteredQueries = computed(() => {
  if (!searchQuery.value) return queries.value
  return queries.value.filter(q => 
    q.sql?.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
})

const getDurationTagType = (duration) => {
  if (duration > 5000) return 'danger'
  if (duration > 1000) return 'warning'
  return 'success'
}

const formatDate = (date) => {
  if (!date) return '-'
  return new Date(date).toLocaleString()
}

const viewDetail = (id) => {
  router.push(`/queries/${id}`)
}

const loadQueries = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/queries', {
      params: { page: currentPage.value, pageSize: pageSize.value }
    })
    queries.value = res.data.data || []
    total.value = res.data.total || 0
  } catch (error) {
    console.error('Failed to load queries:', error)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadQueries()
})
</script>

<style scoped>
.queries-page {
  height: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
