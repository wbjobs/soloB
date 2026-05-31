<template>
  <div class="dashboard">
    <header class="header">
      <h1>Web SSH 堡垒机</h1>
      <div class="user-info">
        <span>{{ authStore.user?.username }}</span>
        <button @click="logout" class="btn-logout">退出</button>
      </div>
    </header>

    <div class="main-content">
      <div class="sidebar">
        <button @click="activeTab = 'servers'" :class="{ active: activeTab === 'servers' }">
          服务器列表
        </button>
        <button @click="activeTab = 'sessions'" :class="{ active: activeTab === 'sessions' }">
          历史会话
        </button>
        <button @click="activeTab = 'alerts'" :class="{ active: activeTab === 'alerts' }">
          告警信息
        </button>
      </div>

      <div class="content">
        <div v-if="activeTab === 'servers'">
          <div class="tab-header">
            <h2>服务器列表</h2>
            <button @click="showAddServer = true" class="btn-primary">添加服务器</button>
          </div>

          <div class="server-list">
            <div v-for="server in servers" :key="server.id" class="server-card">
              <h3>{{ server.name }}</h3>
              <p>{{ server.host }}:{{ server.port }}</p>
              <p>用户: {{ server.ssh_user }}</p>
              <div class="server-actions">
                <button @click="connectServer(server)" class="btn-connect">连接</button>
                <button @click="deleteServer(server.id)" class="btn-delete">删除</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'sessions'">
          <div class="tab-header">
            <h2>历史会话</h2>
          </div>
          <div class="session-list">
            <div v-for="session in sessions" :key="session.id" class="session-item">
              <p>服务器ID: {{ session.server_id }}</p>
              <p>开始时间: {{ formatTime(session.start_time) }}</p>
              <p>状态: {{ session.status }}</p>
              <p>IP: {{ session.client_ip }}</p>
              <div class="session-actions">
                <button v-if="session.status === 'ended'" @click="playback(session.id)" class="btn-playback">回放</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeTab === 'alerts'">
          <div class="tab-header">
            <h2>告警信息</h2>
          </div>
          <div class="alert-list">
            <div v-for="alert in alerts" :key="alert.id" class="alert-item" :class="alert.level">
              <h3>{{ alert.level.toUpperCase() }} 告警</h3>
              <p>命令: {{ alert.command }}</p>
              <p>消息: {{ alert.message }}</p>
              <p>时间: {{ formatTime(alert.timestamp) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showAddServer" class="modal-overlay" @click.self="showAddServer = false">
      <div class="modal">
        <h3>添加服务器</h3>
        <form @submit.prevent="addServer">
          <div class="form-group">
            <label>服务器名称</label>
            <input v-model="newServer.name" type="text" required />
          </div>
          <div class="form-group">
            <label>主机地址</label>
            <input v-model="newServer.host" type="text" required />
          </div>
          <div class="form-group">
            <label>端口</label>
            <input v-model.number="newServer.port" type="number" value="22" required />
          </div>
          <div class="form-group">
            <label>SSH用户名</label>
            <input v-model="newServer.ssh_user" type="text" required />
          </div>
          <div class="form-group">
            <label>SSH密码</label>
            <input v-model="newServer.ssh_password" type="password" required />
          </div>
          <div class="modal-actions">
            <button type="button" @click="showAddServer = false" class="btn-cancel">取消</button>
            <button type="submit" class="btn-submit">添加</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import axios from 'axios'

const authStore = useAuthStore()
const router = useRouter()
const activeTab = ref('servers')
const showAddServer = ref(false)
const servers = ref([])
const sessions = ref([])
const alerts = ref([])
const newServer = ref({
  name: '',
  host: '',
  port: 22,
  ssh_user: '',
  ssh_password: ''
})

function logout() {
  authStore.logout()
  router.push('/login')
}

async function loadServers() {
  const res = await axios.get('/api/servers')
  servers.value = res.data
}

async function loadSessions() {
  const res = await axios.get('/api/sessions')
  sessions.value = res.data
}

async function loadAlerts() {
  const res = await axios.get('/api/alerts')
  alerts.value = res.data
}

async function addServer() {
  await axios.post('/api/servers', newServer.value)
  showAddServer.value = false
  newServer.value = { name: '', host: '', port: 22, ssh_user: '', ssh_password: '' }
  loadServers()
}

async function deleteServer(id) {
  if (confirm('确定删除此服务器？')) {
    await axios.delete(`/api/servers/${id}`)
    loadServers()
  }
}

function connectServer(server) {
  router.push(`/ssh/${server.id}`)
}

function playback(sessionId) {
  router.push(`/playback/${sessionId}`)
}

function formatTime(t) {
  return new Date(t).toLocaleString()
}

onMounted(() => {
  loadServers()
  loadSessions()
  loadAlerts()
})
</script>

<style scoped>
.dashboard {
  min-height: 100vh;
}

.header {
  background: #16213e;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header h1 {
  color: #e94560;
  margin: 0;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.btn-logout {
  background: #e94560;
  color: #fff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
}

.main-content {
  display: flex;
  min-height: calc(100vh - 73px);
}

.sidebar {
  width: 200px;
  background: #0f3460;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sidebar button {
  background: transparent;
  color: #fff;
  border: none;
  padding: 0.75rem 1rem;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.2s;
}

.sidebar button:hover,
.sidebar button.active {
  background: #e94560;
}

.content {
  flex: 1;
  padding: 2rem;
}

.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.btn-primary {
  background: #e94560;
  color: #fff;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 6px;
  cursor: pointer;
}

.server-list,
.session-list,
.alert-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.server-card,
.session-item,
.alert-item {
  background: #16213e;
  padding: 1.5rem;
  border-radius: 8px;
}

.server-card h3 {
  margin-bottom: 0.5rem;
  color: #e94560;
}

.server-card p,
.session-item p,
.alert-item p {
  color: #a0a0a0;
  margin: 0.25rem 0;
}

.server-actions,
.session-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.5rem;
}

.btn-connect,
.btn-playback {
  background: #4caf50;
  color: #fff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

.btn-delete {
  background: #f44336;
  color: #fff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

.alert-item.critical {
  border-left: 4px solid #f44336;
}

.alert-item.high {
  border-left: 4px solid #ff9800;
}

.alert-item h3 {
  color: #f44336;
  margin-bottom: 0.5rem;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal {
  background: #16213e;
  padding: 2rem;
  border-radius: 12px;
  width: 100%;
  max-width: 500px;
}

.modal h3 {
  margin-bottom: 1.5rem;
  color: #e94560;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: #a0a0a0;
}

.form-group input {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #0f3460;
  border-radius: 8px;
  background: #1a1a2e;
  color: #fff;
}

.modal-actions {
  display: flex;
  gap: 1rem;
  margin-top: 1.5rem;
}

.btn-cancel {
  flex: 1;
  padding: 0.75rem;
  background: #555;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.btn-submit {
  flex: 1;
  padding: 0.75rem;
  background: #e94560;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
</style>
