import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'DataSourceList',
    component: () => import('../views/DataSourceList.vue')
  },
  {
    path: '/create',
    name: 'CreateDataSource',
    component: () => import('../views/CreateDataSource.vue')
  },
  {
    path: '/edit/:id',
    name: 'EditDataSource',
    component: () => import('../views/CreateDataSource.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
