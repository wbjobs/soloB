<template>
  <div class="register-container">
    <div class="register-box">
      <h1>注册账号</h1>
      <form @submit.prevent="handleRegister">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="username" type="text" required />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" type="password" required />
        </div>
        <div class="form-group">
          <label>团队/租户名称</label>
          <input v-model="tenant" type="text" required />
        </div>
        <button type="submit" class="btn">注册</button>
        <p>
          已有账号？<router-link to="/login">登录</router-link>
        </p>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const username = ref('')
const password = ref('')
const tenant = ref('')
const router = useRouter()
const authStore = useAuthStore()

async function handleRegister() {
  try {
    await authStore.register(username.value, password.value, tenant.value)
    alert('注册成功，请登录')
    router.push('/login')
  } catch (err) {
    alert('注册失败')
  }
}
</script>

<style scoped>
.register-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

.register-box {
  background: #16213e;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  width: 100%;
  max-width: 400px;
}

h1 {
  text-align: center;
  margin-bottom: 2rem;
  color: #e94560;
}

.form-group {
  margin-bottom: 1rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  color: #a0a0a0;
}

input {
  width: 100%;
  padding: 0.75rem;
  border: 2px solid #0f3460;
  border-radius: 8px;
  background: #1a1a2e;
  color: #fff;
  font-size: 1rem;
}

input:focus {
  outline: none;
  border-color: #e94560;
}

.btn {
  width: 100%;
  padding: 0.75rem;
  background: #e94560;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  margin-top: 1rem;
}

.btn:hover {
  background: #d63850;
}

p {
  text-align: center;
  margin-top: 1rem;
  color: #a0a0a0;
}

a {
  color: #e94560;
  text-decoration: none;
}
</style>
