<template>
  <div class="login-container">
    <div class="login-box">
      <h1>Web SSH 堡垒机</h1>
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <label>用户名</label>
          <input v-model="username" type="text" required />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input v-model="password" type="password" required />
        </div>
        <button type="submit" class="btn">登录</button>
        <p>
          没有账号？<router-link to="/register">注册</router-link>
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
const router = useRouter()
const authStore = useAuthStore()

async function handleLogin() {
  try {
    await authStore.login(username.value, password.value)
    router.push('/')
  } catch (err) {
    alert('登录失败：' + err.response.data.error)
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

.login-box {
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
