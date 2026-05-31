import React from 'react'
import { Layout, Menu } from 'antd'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import {
  DashboardOutlined,
  ScheduleOutlined,
  RocketOutlined,
  SettingOutlined,
  LineChartOutlined
} from '@ant-design/icons'
import Dashboard from './pages/Dashboard.jsx'
import Jobs from './pages/Jobs.jsx'
import Pipelines from './pages/Pipelines.jsx'
import Executors from './pages/Executors.jsx'
import Monitoring from './pages/Monitoring.jsx'

const { Header, Sider, Content } = Layout

function App() {
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/jobs', icon: <ScheduleOutlined />, label: '任务管理' },
    { key: '/pipelines', icon: <RocketOutlined />, label: '流处理管道' },
    { key: '/executors', icon: <SettingOutlined />, label: '执行器节点' },
    { key: '/monitoring', icon: <LineChartOutlined />, label: '监控告警' },
  ]

  const getSelectedKey = () => {
    if (location.pathname === '/') return '/'
    for (const item of menuItems) {
      if (location.pathname.startsWith(item.key) && item.key !== '/') {
        return item.key
      }
    }
    return '/'
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" collapsible>
        <div style={{
          height: 64,
          margin: 16,
          background: 'rgba(255, 255, 255, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontWeight: 'bold',
          fontSize: 18
        }}>
          DTS Platform
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: 0, background: '#fff' }}>
          <div style={{ padding: '0 24px', fontSize: 18, fontWeight: 500 }}>
            分布式任务调度与流处理平台
          </div>
        </Header>
        <Content style={{ margin: '16px', padding: 24, background: '#fff', minHeight: 280 }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:id" element={<Jobs />} />
            <Route path="/pipelines" element={<Pipelines />} />
            <Route path="/executors" element={<Executors />} />
            <Route path="/monitoring" element={<Monitoring />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default App
