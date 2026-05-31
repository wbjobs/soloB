import React, { useState, useEffect } from 'react'
import { Table, Card, Tag, Space, Button, message, Empty } from 'antd'
import { SyncOutlined, EnvironmentOutlined } from '@ant-design/icons'
import { executorsApi } from '../services/api'

function Executors() {
  const [executors, setExecutors] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadExecutors()
  }, [])

  const loadExecutors = async () => {
    try {
      const res = await executorsApi.list()
      setExecutors(res.data.data || [])
    } catch (err) {
      message.error('加载执行器失败')
    } finally {
      setLoading(false)
    }
  }

  const columns = [
    { title: '执行器ID', dataIndex: 'id', key: 'id' },
    { title: '地址', dataIndex: 'address', key: 'address' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        if (status === 'online') return <Tag color="green">在线</Tag>
        if (status === 'offline') return <Tag color="red">离线</Tag>
        return <Tag color="orange">{status}</Tag>
      }
    },
    {
      title: '负载',
      key: 'load',
      render: (_, record) => (
        <span>{record.current_load || 0} / {record.max_tasks || 10}</span>
      )
    },
    {
      title: '支持类型',
      dataIndex: 'supported_types',
      key: 'supported_types',
      render: (types) => (
        <Space>
          {types?.map((t, i) => <Tag key={i}>{t}</Tag>) || '-'}
        </Space>
      )
    },
    { title: '最后心跳', dataIndex: 'last_heartbeat', key: 'last_heartbeat' }
  ]

  return (
    <Card
      title="执行器节点管理"
      extra={
        <Button icon={<SyncOutlined />} onClick={loadExecutors}>
          刷新
        </Button>
      }
    >
      {executors.length === 0 ? (
        <Empty description="暂无执行器节点" />
      ) : (
        <Table
          columns={columns}
          dataSource={executors}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      )}
    </Card>
  )
}

export default Executors
