import { defineStore } from 'pinia'
import axios from 'axios'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null')
  }),
  actions: {
    async login(username, password) {
      const res = await axios.post('/api/auth/login', { username, password })
      this.token = res.data.token
      this.user = res.data.user
      localStorage.setItem('token', res.data.token)
      localStorage.setItem('user', JSON.stringify(res.data.user))
      axios.defaults.headers.common['Authorization'] = res.data.token
    },
    async register(username, password, tenant) {
      await axios.post('/api/auth/register', { username, password, tenant })
    },
    logout() {
      this.token = ''
      this.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      delete axios.defaults.headers.common['Authorization']
    }
  }
})

if (localStorage.getItem('token')) {
  axios.defaults.headers.common['Authorization'] = localStorage.getItem('token')
}
