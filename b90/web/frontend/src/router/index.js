import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Queries from '../views/Queries.vue'
import QueryDetail from '../views/QueryDetail.vue'
import Metrics from '../views/Metrics.vue'
import Reports from '../views/Reports.vue'
import Anomalies from '../views/Anomalies.vue'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: Dashboard
  },
  {
    path: '/queries',
    name: 'Queries',
    component: Queries
  },
  {
    path: '/queries/:id',
    name: 'QueryDetail',
    component: QueryDetail
  },
  {
    path: '/metrics',
    name: 'Metrics',
    component: Metrics
  },
  {
    path: '/anomalies',
    name: 'Anomalies',
    component: Anomalies
  },
  {
    path: '/reports',
    name: 'Reports',
    component: Reports
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
