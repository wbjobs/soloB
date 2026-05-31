<template>
  <div class="create-data-source">
    <div class="page-header">
      <el-button @click="goBack">
        <el-icon><ArrowLeft /></el-icon>
        返回
      </el-button>
      <h2>{{ isEdit ? '编辑数据源' : '新建数据源' }}</h2>
    </div>

    <el-row :gutter="20">
      <el-col :span="8">
        <el-card class="config-card">
          <template #header>
            <div class="card-header">
              <span>数据源配置</span>
              <el-button
                v-if="isTestContainerAvailable"
                type="success"
                size="small"
                @click="handleCreateTestContainer"
                :loading="creatingContainer"
              >
                创建测试容器
              </el-button>
            </div>
          </template>

          <el-form ref="formRef" :model="form" label-width="120px">
            <el-form-item label="数据源名称" prop="name" :rules="[{ required: true, message: '请输入数据源名称' }]">
              <el-input v-model="form.name" placeholder="请输入数据源名称" />
            </el-form-item>

            <el-form-item label="数据源类型" prop="type" :rules="[{ required: true, message: '请选择数据源类型' }]">
              <el-select v-model="form.type" placeholder="请选择数据源类型" style="width: 100%" @change="onTypeChange">
                <el-option label="MySQL" value="mysql" />
                <el-option label="PostgreSQL" value="postgresql" />
                <el-option label="MongoDB" value="mongodb" />
                <el-option label="REST API" value="rest_api" />
              </el-select>
            </el-form-item>

            <div v-if="isDatabaseType">
              <el-form-item label="主机地址">
                <el-input v-model="form.config.host" placeholder="localhost" />
              </el-form-item>

              <el-form-item label="端口">
                <el-input-number v-model="form.config.port" :min="1" :max="65535" style="width: 100%" />
              </el-form-item>

              <el-form-item label="数据库名">
                <el-input v-model="form.config.database" placeholder="数据库名称" />
              </el-form-item>

              <el-form-item label="用户名">
                <el-input v-model="form.config.username" placeholder="用户名" />
              </el-form-item>

              <el-form-item label="密码">
                <el-input v-model="form.config.password" type="password" placeholder="密码" show-password />
              </el-form-item>

              <el-form-item v-if="form.type === 'mongodb'" label="连接字符串">
                <el-input v-model="form.config.connectionString" placeholder="mongodb://user:pass@host:port/db" type="textarea" :rows="2" />
              </el-form-item>
            </div>

            <div v-if="form.type === 'rest_api'">
              <el-form-item label="API地址">
                <el-input v-model="form.config.url" placeholder="https://api.example.com" />
              </el-form-item>

              <el-form-item label="认证类型">
                <el-select v-model="form.config.auth?.type" placeholder="请选择认证类型" style="width: 100%" clearable>
                  <el-option label="无认证" :value="undefined" />
                  <el-option label="Basic Auth" value="basic" />
                  <el-option label="Bearer Token" value="bearer" />
                  <el-option label="API Key" value="api_key" />
                </el-select>
              </el-form-item>

              <template v-if="form.config.auth?.type === 'basic'">
                <el-form-item label="用户名">
                  <el-input v-model="form.config.auth.username" />
                </el-form-item>
                <el-form-item label="密码">
                  <el-input v-model="form.config.auth.password" type="password" show-password />
                </el-form-item>
              </template>

              <template v-if="form.config.auth?.type === 'bearer'">
                <el-form-item label="Token">
                  <el-input v-model="form.config.auth.token" type="textarea" :rows="2" />
                </el-form-item>
              </template>

              <template v-if="form.config.auth?.type === 'api_key'">
                <el-form-item label="Header名称">
                  <el-input v-model="form.config.auth.apiKeyHeader" placeholder="X-API-Key" />
                </el-form-item>
                <el-form-item label="API Key">
                  <el-input v-model="form.config.auth.apiKey" />
                </el-form-item>
              </template>

              <el-divider content-position="left">自定义Headers</el-divider>
              
              <el-form-item label="请求Headers">
                <el-table
                  :data="customHeaders"
                  size="small"
                  style="width: 100%; margin-bottom: 10px"
                  border
                >
                  <el-table-column prop="key" label="Header Key" width="45%">
                    <template #default="{ row, $index }">
                      <el-input v-model="customHeaders[$index].key" placeholder="如: Content-Type" size="small" />
                    </template>
                  </el-table-column>
                  <el-table-column prop="value" label="Header Value">
                    <template #default="{ row, $index }">
                      <el-input v-model="customHeaders[$index].value" placeholder="如: application/json" size="small" />
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="80" fixed="right">
                    <template #default="{ $index }">
                      <el-button type="danger" size="small" link @click="removeHeader($index)">删除</el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <el-button type="primary" size="small" @click="addHeader">
                  <el-icon><Plus /></el-icon>
                  添加Header
                </el-button>
              </el-form-item>
            </div>

            <el-divider content-position="left">性能预测</el-divider>
            
            <el-form-item label="测试时长">
              <el-select v-model="testDuration" style="width: 150px">
                <el-option label="3秒" :value="3000" />
                <el-option label="5秒" :value="5000" />
                <el-option label="10秒" :value="10000" />
              </el-select>
              <el-button 
                type="warning" 
                @click="handlePredictPerformance" 
                :loading="predicting"
                style="margin-left: 10px"
              >
                <el-icon><TrendCharts /></el-icon>
                预测连接池性能
              </el-button>
            </el-form-item>

            <el-form-item>
              <el-button type="primary" @click="handlePreviewCode" :loading="generatingCode">
                预览代码
              </el-button>
              <el-button type="success" @click="handleSave" :loading="saving">
                {{ isEdit ? '保存修改' : '创建数据源' }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="16">
        <el-card class="code-card">
          <template #header>
            <div class="card-header">
              <span>生成的代码</span>
              <div class="header-actions">
                <el-button v-if="dataSourceId" type="success" size="small" @click="handleTestConnection" :loading="testing">
                  <el-icon><Connection /></el-icon>
                  测试连接
                </el-button>
                <el-button v-if="dataSourceId" type="warning" size="small" @click="handleExportNpm">
                  <el-icon><Download /></el-icon>
                  导出NPM
                </el-button>
                <el-button type="primary" size="small" @click="copyCode">
                  <el-icon><CopyDocument /></el-icon>
                  复制代码
                </el-button>
              </div>
            </div>
          </template>

          <CodeEditor v-model="generatedCode" language="javascript" read-only />
        </el-card>

        <el-card v-if="testContainer" class="container-card" style="margin-top: 20px">
          <template #header>
            <div class="card-header">
              <span>测试容器信息</span>
              <el-button type="danger" size="small" @click="handleStopContainer">
                停止容器
              </el-button>
            </div>
          </template>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="容器ID">{{ testContainer.containerId }}</el-descriptions-item>
            <el-descriptions-item label="主机地址">{{ testContainer.host }}</el-descriptions-item>
            <el-descriptions-item label="端口">{{ testContainer.port }}</el-descriptions-item>
            <el-descriptions-item label="凭据">
              <el-tag v-if="testContainer.credentials.username">{{ testContainer.credentials.username }}</el-tag>
              <el-tag v-if="testContainer.credentials.password" type="info">{{ testContainer.credentials.password }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>
          <div style="margin-top: 15px">
            <el-button type="primary" @click="fillCredentials">
              <el-icon><MagicStick /></el-icon>
              自动填充凭据
            </el-button>
          </div>
        </el-card>

        <el-card v-if="performanceResult" class="performance-card" style="margin-top: 20px">
          <template #header>
            <div class="card-header">
              <span>连接池性能预测结果</span>
              <el-button v-if="dataSourceId" type="primary" size="small" @click="exportPerformanceReport">
                <el-icon><Download /></el-icon>
                导出报告
              </el-button>
            </div>
          </template>

          <el-alert
            :title="`推荐连接池大小: ${performanceResult.recommendedPoolSize}`"
            type="success"
            :closable="false"
            style="margin-bottom: 20px"
          >
            <template #default>
              <p>预计最优并发数: {{ performanceResult.analysis.optimalConcurrency }}</p>
              <p>预计最大吞吐量: {{ performanceResult.analysis.estimatedMaxThroughput }} 请求/秒</p>
            </template>
          </el-alert>

          <el-tabs v-model="activeTab">
            <el-tab-pane label="性能对比" name="metrics">
              <el-table :data="performanceResult.metrics" border size="small">
                <el-table-column prop="poolSize" label="连接池大小" width="100" />
                <el-table-column prop="avgResponseTime" label="平均响应(ms)" width="120" />
                <el-table-column prop="p95ResponseTime" label="P95响应(ms)" width="120" />
                <el-table-column prop="p99ResponseTime" label="P99响应(ms)" width="120" />
                <el-table-column prop="throughput" label="吞吐量(/s)" width="120" />
                <el-table-column prop="errorRate" label="错误率(%)" width="100" />
                <el-table-column prop="queueLength" label="排队数" width="100" />
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="瓶颈分析" name="bottlenecks">
              <el-empty v-if="performanceResult.analysis.bottlenecks.length === 0" description="未检测到明显瓶颈，配置良好" />
              <div v-else>
                <div
                  v-for="(b, i) in performanceResult.analysis.bottlenecks"
                  :key="i"
                  class="bottleneck-item"
                >
                  <el-icon color="#e6a23c"><Warning /></el-icon>
                  <span>{{ b }}</span>
                </div>
              </div>
            </el-tab-pane>

            <el-tab-pane label="优化建议" name="recommendations">
              <div v-for="(r, i) in performanceResult.analysis.recommendations" :key="i" class="recommendation-item">
                <el-icon color="#67c23a"><CircleCheck /></el-icon>
                <span>{{ r }}</span>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { ArrowLeft, Connection, Download, CopyDocument, MagicStick, Plus, TrendCharts, Warning, CircleCheck } from '@element-plus/icons-vue'
import { dataSourceApi } from '../api'
import CodeEditor from '../components/CodeEditor.vue'
import type { DataSourceType, IDataSourceConfig } from '../types'

const router = useRouter()
const route = useRoute()
const formRef = ref<FormInstance>()

const isEdit = computed(() => !!route.params.id)
const dataSourceId = computed(() => route.params.id as string)
const isTestContainerAvailable = computed(() => 
  ['mysql', 'postgresql', 'mongodb'].includes(form.value.type)
)

const form = ref<{
  name: string
  type: DataSourceType
  config: IDataSourceConfig
}>({
  name: '',
  type: 'mysql' as DataSourceType,
  config: {
    host: 'localhost',
    port: 3306,
    database: '',
    username: '',
    password: '',
    connectionString: '',
    url: '',
    headers: {},
    auth: {
      type: undefined,
      username: '',
      password: '',
      token: '',
      apiKey: '',
      apiKeyHeader: 'X-API-Key'
    }
  }
})

const generatedCode = ref('')
const saving = ref(false)
const generatingCode = ref(false)
const testing = ref(false)
const creatingContainer = ref(false)
const testContainer = ref<any>(null)
const customHeaders = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
const testDuration = ref(5000)
const predicting = ref(false)
const performanceResult = ref<any>(null)
const activeTab = ref('metrics')

const isDatabaseType = computed(() => 
  ['mysql', 'postgresql', 'mongodb'].includes(form.value.type)
)

const syncHeaders = () => {
  const headers: Record<string, string> = {}
  customHeaders.value.forEach((h) => {
    if (h.key && h.value) {
      headers[h.key] = h.value
    }
  })
  form.value.config.headers = headers
}

const addHeader = () => {
  customHeaders.value.push({ key: '', value: '' })
  syncHeaders()
}

const removeHeader = (index: number) => {
  customHeaders.value.splice(index, 1)
  syncHeaders()
}

const onTypeChange = () => {
  const defaultPorts: Record<string, number> = {
    mysql: 3306,
    postgresql: 5432,
    mongodb: 27017
  }
  if (form.value.type in defaultPorts) {
    form.value.config.port = defaultPorts[form.value.type]
  }
  generatedCode.value = ''
}

const handlePreviewCode = async () => {
  if (!form.value.name || !form.value.type) {
    ElMessage.warning('请先填写数据源名称和类型')
    return
  }

  if (form.value.type === 'rest_api') {
    syncHeaders()
  }

  generatingCode.value = true
  try {
    const response = await dataSourceApi.generateCode({
      name: form.value.name,
      type: form.value.type,
      config: form.value.config
    })
    generatedCode.value = response.data.code
    ElMessage.success('代码生成成功')
  } catch (error: any) {
    ElMessage.error('生成代码失败: ' + error.message)
  } finally {
    generatingCode.value = false
  }
}

const handleSave = async () => {
  if (!formRef.value) return
  
  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (form.value.type === 'rest_api') {
    syncHeaders()
  }

  saving.value = true
  try {
    if (isEdit.value) {
      await dataSourceApi.update(dataSourceId.value, form.value)
      ElMessage.success('数据源更新成功')
    } else {
      const response = await dataSourceApi.create(form.value)
      ElMessage.success('数据源创建成功')
      router.replace(`/edit/${response.data.id}`)
    }
    await handlePreviewCode()
  } catch (error: any) {
    ElMessage.error('保存失败: ' + error.message)
  } finally {
    saving.value = false
  }
}

const handleTestConnection = async () => {
  if (!dataSourceId.value) return
  
  testing.value = true
  try {
    const response = await dataSourceApi.testConnection(dataSourceId.value)
    if (response.data.success) {
      ElMessage.success(response.data.message || '连接测试成功')
    } else {
      ElMessage.error(response.data.error || '连接测试失败')
    }
  } catch (error: any) {
    ElMessage.error('连接测试失败: ' + error.message)
  } finally {
    testing.value = false
  }
}

const handleExportNpm = async () => {
  if (!dataSourceId.value) return

  try {
    const { value: version } = await ElMessageBox.prompt('请输入版本号', '导出NPM包', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /^\d+\.\d+\.\d+$/,
      inputErrorMessage: '请输入有效的版本号 (如 1.0.0)',
      inputValue: '1.0.0'
    })

    const response = await dataSourceApi.exportNpm(dataSourceId.value, version)
    const blob = new Blob([response.data], { type: 'application/zip' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${form.value.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${version}.zip`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('NPM包导出成功')
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('导出NPM包失败: ' + error.message)
    }
  }
}

const handleCreateTestContainer = async () => {
  creatingContainer.value = true
  try {
    const response = await dataSourceApi.createTestContainer(form.value.type)
    testContainer.value = response.data
    ElMessage.success('测试容器创建成功，请等待容器启动后使用')
  } catch (error: any) {
    ElMessage.error('创建测试容器失败: ' + error.message)
  } finally {
    creatingContainer.value = false
  }
}

const handleStopContainer = async () => {
  if (!testContainer.value) return
  
  try {
    await dataSourceApi.stopTestContainer(testContainer.value.containerId)
    testContainer.value = null
    ElMessage.success('容器已停止')
  } catch (error: any) {
    ElMessage.error('停止容器失败: ' + error.message)
  }
}

const fillCredentials = () => {
  if (!testContainer.value) return
  
  const { host, port, credentials } = testContainer.value
  form.value.config.host = host
  
  if (form.value.type !== 'mongodb') {
    form.value.config.port = port
    form.value.config.username = credentials.username
    form.value.config.password = credentials.password
    form.value.config.database = credentials.database
  } else {
    form.value.config.connectionString = credentials.connectionString
  }
  
  ElMessage.success('凭据已自动填充')
}

const handlePredictPerformance = async () => {
  if (!form.value.type) {
    ElMessage.warning('请先选择数据源类型')
    return
  }

  predicting.value = true
  performanceResult.value = null
  
  try {
    const response = await dataSourceApi.predictPerformance(
      form.value.type,
      form.value.config,
      testDuration.value
    )
    performanceResult.value = response.data
    ElMessage.success('性能预测完成')
  } catch (error: any) {
    ElMessage.error('性能预测失败: ' + error.message)
  } finally {
    predicting.value = false
  }
}

const exportPerformanceReport = async () => {
  if (!dataSourceId.value) return
  
  try {
    const response = await dataSourceApi.exportPerformanceReport(dataSourceId.value, testDuration.value)
    const blob = new Blob([response.data], { type: 'text/plain;charset=utf-8' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `performance-report-${form.value.name}.txt`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('报告导出成功')
  } catch (error: any) {
    ElMessage.error('导出报告失败: ' + error.message)
  }
}

const copyCode = async () => {
  if (!generatedCode.value) {
    ElMessage.warning('没有可复制的代码')
    return
  }
  
  try {
    await navigator.clipboard.writeText(generatedCode.value)
    ElMessage.success('代码已复制到剪贴板')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

const goBack = () => {
  router.push('/')
}

const loadDataSource = async () => {
  if (!isEdit.value) return
  
  try {
    const response = await dataSourceApi.getById(dataSourceId.value)
    const data = response.data
    form.value.name = data.name
    form.value.type = data.type
    form.value.config = data.config
    generatedCode.value = data.generatedCode || ''

    if (data.type === 'rest_api' && data.config.headers) {
      const savedHeaders = Object.entries(data.config.headers as Record<string, string>).map(
        ([key, value]) => ({ key, value })
      )
      customHeaders.value = savedHeaders.length > 0 
        ? savedHeaders 
        : [{ key: '', value: '' }]
    }
  } catch (error: any) {
    ElMessage.error('加载数据源失败: ' + error.message)
  }
}

watch(
  customHeaders,
  () => {
    if (form.value.type === 'rest_api') {
      syncHeaders()
    }
  },
  { deep: true }
)

onMounted(() => {
  loadDataSource()
})
</script>

<style scoped>
.create-data-source {
  max-width: 1600px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}

.config-card,
.code-card,
.container-card,
.performance-card {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.bottleneck-item,
.recommendation-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 10px;
  border-radius: 6px;
}

.bottleneck-item {
  background-color: #fdf6ec;
  border: 1px solid #f5dab1;
}

.recommendation-item {
  background-color: #f0f9eb;
  border: 1px solid #c2e7b0;
}

.bottleneck-item span,
.recommendation-item span {
  line-height: 1.6;
  color: #606266;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 10px;
}
</style>
