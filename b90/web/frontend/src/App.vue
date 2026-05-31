<template>
  <el-container class="app-container">
    <el-aside width="220px" class="sidebar">
      <div class="logo">
        <h2>DB Profiler</h2>
      </div>
      <el-menu
        :default-active="activeMenu"
        class="el-menu-vertical"
        router
      >
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon>
          <span>Dashboard</span>
        </el-menu-item>
        <el-menu-item index="/queries">
          <el-icon><Document /></el-icon>
          <span>Slow Queries</span>
        </el-menu-item>
        <el-menu-item index="/metrics">
          <el-icon><DataAnalysis /></el-icon>
          <span>Metrics</span>
        </el-menu-item>
        <el-menu-item index="/anomalies">
          <el-icon><Warning /></el-icon>
          <span>Anomalies</span>
        </el-menu-item>
        <el-menu-item index="/reports">
          <el-icon><Reading /></el-icon>
          <span>Reports</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    
    <el-container>
      <el-header class="header">
        <div class="header-content">
          <h3>Database Performance Analysis</h3>
          <div class="status-indicator">
            <el-icon v-if="isConnected" style="color: #67c23a"><CircleCheck /></el-icon>
            <el-icon v-else style="color: #f56c6c"><Close /></el-icon>
            <span>{{ isConnected ? 'Connected' : 'Disconnected' }}</span>
          </div>
        </div>
      </el-header>
      
      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { 
  Odometer, Document, DataAnalysis, Warning, Reading, CircleCheck, Close 
} from '@element-plus/icons-vue'
import axios from 'axios'

const route = useRoute()
const isConnected = ref(true)

const activeMenu = computed(() => route.path)

onMounted(async () => {
  try {
    await axios.get('/api/health')
    isConnected.value = true
  } catch {
    isConnected.value = false
  }
})
</script>

<style scoped>
.app-container {
  height: 100vh;
}

.sidebar {
  background-color: #2c3e50;
  color: white;
}

.logo {
  padding: 20px;
  text-align: center;
  border-bottom: 1px solid #34495e;
}

.logo h2 {
  margin: 0;
  color: #ecf0f1;
  font-size: 18px;
}

.el-menu-vertical {
  background-color: #2c3e50;
  border: none;
}

.el-menu-vertical .el-menu-item {
  color: #bdc3c7;
}

.el-menu-vertical .el-menu-item:hover {
  background-color: #34495e;
  color: white;
}

.el-menu-vertical .el-menu-item.is-active {
  background-color: #3498db;
  color: white;
}

.header {
  background-color: white;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 20px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
}

.header-content h3 {
  margin: 0;
  color: #2c3e50;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.main-content {
  background-color: #f5f7fa;
  padding: 20px;
}
</style>
