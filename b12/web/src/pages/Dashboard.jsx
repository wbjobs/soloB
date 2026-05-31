import React, { useState, useEffect } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, message } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { jobsApi, healthApi } from '../services/api'

function Dashboard() {
  const [jobs, setJobs] = useState([])
  const [health, setHealth] = useState({ status: 'unknown' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [jobsRes, healthRes] = await Promise.all([
        jobsApi.list(),
        healthApi.check()
      ])
      setJobs(jobsRes.data.data || [])
      setHealth(healthRes.data)
    } catch (err) {
      message.error('加载数据失败')
    } finally {
      setLoading(false)
    }
  }

  const activeJobs = jobs.filter(j => j.status === 'active' && !j.paused).length
  const pausedJobs = jobs.filter(j => j.paused).length
  const totalRuns = jobs.reduce((sum, j) => sum + (j.total_runs || 0), 0)
  const successRuns = jobs.reduce((sum, j) => sum + (j.success_runs || 0), 0)
  const failedRuns = jobs.reduce((sum, j) => sum + (j.failed_runs || 0), 0)

  const successRate = totalRuns > 0 ? ((successRuns / totalRuns) * 100).toFixed(1) : 0

  const columns = [
    { title: '任务ID', dataIndex: 'id', key: 'id' },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (_, record) => {
        if (record.paused) return <Tag color="orange">暂停</Tag>
        if (record.status === 'active') return <Tag color="green">运行中</Tag>
        return <Tag color="default">{record.status}</Tag>
      }
    },
    { title: 'Cron', dataIndex: 'cron', key: 'cron' },
    {
      title: '运行统计',
      key: 'stats',
      render: (_, record) => (
        <span>
          {record.success_runs || 0}成功 / {record.failed_runs || 0}失败
        </span>
      )
    }
  ]

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card>
            <Statistic
              title="活跃任务"
              value={activeJobs}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="暂停任务"
              value={pausedJobs}
              prefix={<ClockCircleOutlined style={{ color: '#faad14' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="成功率"
              value={successRate}
              suffix="%"
              prefix={<SyncOutlined style={{ color: '#1890ff' }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="失败任务"
              value={failedRuns}
              prefix={<CloseCircleOutlined style={{ color: '#ff4d4f' }} />}
            />
          </Card>
        </Col>
      </Row>

      <Card title="系统状态" style={{ marginTop: 24 }}>
        <p>健康状态: {health.status}</p>
        <p>Leader: {health.leader ? '是' : '否'}</p>
        <p>当前时间: {health.time}</p>
      </Card>

      <Card title="任务概览" style={{ marginTop: 24 }}>
        <Table
          columns={columns}
          dataSource={jobs}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </div>
  )
}

export default Dashboard
