import React, { useState, useEffect } from 'react'
import {
  Table,
  Button,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  message,
  Popconfirm,
  Card,
  Descriptions,
  Row,
  Col
} from 'antd'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { jobsApi } from '../services/api'
import { useNavigate } from 'react-router-dom'

const { Option } = Select
const { TextArea } = Input

function Jobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [createModal, setCreateModal] = useState(false)
  const [detailModal, setDetailModal] = useState(false)
  const [selectedJob, setSelectedJob] = useState(null)
  const [form] = Form.useForm()
  const navigate = useNavigate()

  useEffect(() => {
    loadJobs()
  }, [])

  const loadJobs = async () => {
    try {
      const res = await jobsApi.list()
      setJobs(res.data.data || [])
    } catch (err) {
      message.error('加载任务失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (values) => {
    try {
      await jobsApi.create(values)
      message.success('创建任务成功')
      setCreateModal(false)
      form.resetFields()
      loadJobs()
    } catch (err) {
      message.error('创建任务失败')
    }
  }

  const handleTrigger = async (id) => {
    try {
      await jobsApi.trigger(id)
      message.success('任务已触发')
    } catch (err) {
      message.error('触发失败')
    }
  }

  const handlePause = async (id, paused) => {
    try {
      if (paused) {
        await jobsApi.resume(id)
        message.success('任务已恢复')
      } else {
        await jobsApi.pause(id)
        message.success('任务已暂停')
      }
      loadJobs()
    } catch (err) {
      message.error('操作失败')
    }
  }

  const handleDelete = async (id) => {
    try {
      await jobsApi.delete(id)
      message.success('删除成功')
      loadJobs()
    } catch (err) {
      message.error('删除失败')
    }
  }

  const handleView = async (job) => {
    setSelectedJob(job)
    setDetailModal(true)
  }

  const columns = [
    { title: '任务ID', dataIndex: 'id', key: 'id', width: 150 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '类型', dataIndex: 'type', key: 'type', width: 100 },
    { title: 'Cron', dataIndex: 'cron', key: 'cron', width: 150 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (_, record) => {
        if (record.paused) return <Tag color="orange">暂停</Tag>
        if (record.status === 'active') return <Tag color="green">运行中</Tag>
        return <Tag color="default">{record.status}</Tag>
      }
    },
    {
      title: '重试',
      dataIndex: 'max_retries',
      key: 'max_retries',
      width: 80
    },
    {
      title: '统计',
      key: 'stats',
      width: 120,
      render: (_, record) => (
        <span>
          成:{record.success_runs || 0} 失:{record.failed_runs || 0}
        </span>
      )
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<PlayCircleOutlined />}
            onClick={() => handleTrigger(record.id)}
          >
            触发
          </Button>
          <Button
            type="link"
            icon={record.paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={() => handlePause(record.id, record.paused)}
          >
            {record.paused ? '恢复' : '暂停'}
          </Button>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleView(record)}
          >
            详情
          </Button>
          <Popconfirm
            title="确定删除?"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <Card
        title="任务管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModal(true)}>
            创建任务
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={jobs}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1200 }}
        />
      </Card>

      <Modal
        title="创建任务"
        open={createModal}
        onCancel={() => setCreateModal(false)}
        onOk={() => form.submit()}
        width={800}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="id"
                label="任务ID"
                rules={[{ required: true, message: '请输入任务ID' }]}
              >
                <Input placeholder="例如: job-001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label="任务名称"
                rules={[{ required: true, message: '请输入任务名称' }]}
              >
                <Input placeholder="任务名称" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="描述">
            <TextArea rows={2} placeholder="任务描述" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="type"
                label="任务类型"
                rules={[{ required: true, message: '请选择类型' }]}
                initialValue="shell"
              >
                <Select>
                  <Option value="shell">Shell脚本</Option>
                  <Option value="python">Python函数</Option>
                  <Option value="http">HTTP回调</Option>
                  <Option value="docker">Docker容器</Option>
                  <Option value="dag">DAG工作流</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="cron" label="Cron表达式">
                <Input placeholder="例如: 0 * * * * * (每分钟)" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="max_retries" label="最大重试" initialValue={3}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="timeout" label="超时时间(秒)" initialValue={300}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="任务详情"
        open={detailModal}
        onCancel={() => setDetailModal(false)}
        footer={null}
        width={800}
      >
        {selectedJob && (
          <Descriptions bordered column={2}>
            <Descriptions.Item label="ID">{selectedJob.id}</Descriptions.Item>
            <Descriptions.Item label="名称">{selectedJob.name}</Descriptions.Item>
            <Descriptions.Item label="类型" span={2}>{selectedJob.type}</Descriptions.Item>
            <Descriptions.Item label="状态">{selectedJob.status}</Descriptions.Item>
            <Descriptions.Item label="暂停">{selectedJob.paused ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="Cron" span={2}>{selectedJob.cron || '无'}</Descriptions.Item>
            <Descriptions.Item label="重试次数">{selectedJob.max_retries}</Descriptions.Item>
            <Descriptions.Item label="超时">{selectedJob.timeout / 1000000000}秒</Descriptions.Item>
            <Descriptions.Item label="总运行" span={2}>
              成功: {selectedJob.success_runs || 0}, 失败: {selectedJob.failed_runs || 0}, 总计: {selectedJob.total_runs || 0}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间" span={2}>
              {selectedJob.created_at}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  )
}

export default Jobs
