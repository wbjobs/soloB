<template>
  <div class="data-source-list">
    <div class="page-header">
      <h2>数据源列表</h2>
      <el-button type="primary" @click="goToCreate">
        <el-icon><Plus /></el-icon>
        新建数据源
      </el-button>
    </div>

    <el-card class="list-card">
      <el-table :data="dataSources" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="name" label="名称" width="200" />
        <el-table-column prop="type" label="类型" width="150">
          <template #default="{ row }">
            <el-tag :type="getTypeTagType(row.type)">
              {{ getTypeLabel(row.type) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" @click="goToEdit(row.id)">
              编辑
            </el-button>
            <el-button type="success" size="small" @click="handleTestConnection(row.id)" :loading="testingId === row.id">
              测试连接
            </el-button>
            <el-button type="warning" size="small" @click="handleExportNpm(row.id)">
              导出NPM
            </el-button>
            <el-button type="danger" size="small" @click="handleDelete(row.id)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { dataSourceApi } from '../api'
import type { IDataSource, DataSourceType } from '../types'

const router = useRouter()
const loading = ref(false)
const testingId = ref<string | null>(null)
const dataSources = ref<IDataSource[]>([])

const loadDataSources = async () => {
  loading.value = true
  try {
    const response = await dataSourceApi.getAll()
    dataSources.value = response.data
  } catch (error: any) {
    ElMessage.error('加载数据源列表失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

const goToCreate = () => {
  router.push('/create')
}

const goToEdit = (id: string) => {
  router.push(`/edit/${id}`)
}

const handleTestConnection = async (id: string) => {
  testingId.value = id
  try {
    const response = await dataSourceApi.testConnection(id)
    if (response.data.success) {
      ElMessage.success(response.data.message || '连接测试成功')
    } else {
      ElMessage.error(response.data.error || '连接测试失败')
    }
  } catch (error: any) {
    ElMessage.error('连接测试失败: ' + error.message)
  } finally {
    testingId.value = null
  }
}

const handleExportNpm = async (id: string) => {
  try {
    const { value: version } = await ElMessageBox.prompt('请输入版本号', '导出NPM包', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /^\d+\.\d+\.\d+$/,
      inputErrorMessage: '请输入有效的版本号 (如 1.0.0)',
      inputValue: '1.0.0'
    })

    const response = await dataSourceApi.exportNpm(id, version)
    const blob = new Blob([response.data], { type: 'application/zip' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `data-source-${version}.zip`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('NPM包导出成功')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('导出NPM包失败: ' + error.message)
    }
  }
}

const handleDelete = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定要删除这个数据源吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    await dataSourceApi.delete(id)
    ElMessage.success('删除成功')
    loadDataSources()
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败: ' + error.message)
    }
  }
}

const getTypeLabel = (type: DataSourceType) => {
  const labels: Record<DataSourceType, string> = {
    mysql: 'MySQL',
    postgresql: 'PostgreSQL',
    mongodb: 'MongoDB',
    rest_api: 'REST API'
  }
  return labels[type] || type
}

const getTypeTagType = (type: DataSourceType) => {
  const types: Record<DataSourceType, string> = {
    mysql: 'primary',
    postgresql: 'success',
    mongodb: 'warning',
    rest_api: 'info'
  }
  return types[type] || 'info'
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(() => {
  loadDataSources()
})
</script>

<style scoped>
.data-source-list {
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}

.list-card {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
</style>
