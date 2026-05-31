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
  Col,
  Switch
} from 'antd'
import {
  PlayCircleOutlined,
  StopOutlined,
  DeleteOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { pipelinesApi } from '../services/api'

const { Option } = Select

function Pipelines() {
  const [pipelines, setPipelines] = useState([])
  const [loading, setLoading] = useState(true)
  const [createModal, setCreateModal] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    loadPipelines()
  }, [])

  const loadPipelines = async () => {
    try {
      const res = await pipelinesApi.list()
      setPipelines(res.data.data || [])
    } catch (err) {
      message.error('加载管道失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (values) => {
    try {
      const pipeline = {
        name: values.name,
        source_topic: values.source_topic,
        target_topic: values.target_topic,
        transform: values.transform_type ? {
          type: values.transform_type,
          expression: values.transform_expression || ''
        } : undefined,
        window: values.window_type ? {
          type: values.window_type,
          size_ms: values.window_size_ms,
          slide_ms: values.window_slide_ms,
          gap_ms: values.window_gap_ms
        } : undefined,
        exactly_once: values.exactly_once ? {
          enabled: true,
          transactional_id: values.transactional_id
        } : undefined
      }

      await pipelinesApi.create(pipeline)
      message.success('创建管道成功')
      setCreateModal(false)
      form.resetFields()
      loadPipelines()
    } catch (err) {
      message.error('创建管道失败')
    }
  }

  const handleStart = async (id) => {
    try {
      await pipelinesApi.start(id)
      message.success('管道已启动')
      loadPipelines()
    } catch (err) {
      message.error('启动失败')
    }
  }

  const handleStop = async (id) => {
    try {
      await pipelinesApi.stop(id)
      message.success('管道已停止')
      loadPipelines()
    } catch (err) {
      message.error('停止失败')
    }
  }

  const handleDelete = async (id) => {
    try {
      await pipelinesApi.delete(id)
      message.success('删除成功')
      loadPipelines()
    } catch (err) {
      message.error('删除失败')
    }
  }

  const columns = [
    { title: '管道ID', dataIndex: 'id', key: 'id', width: 180 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '源Topic', dataIndex: 'source_topic', key: 'source_topic' },
    { title: '目标Topic', dataIndex: 'target_topic', key: 'target_topic' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        if (status === 'running') return <Tag color="green">运行中</Tag>
        return <Tag color="default">已停止</Tag>
      }
    },
    {
      title: '处理消息',
      dataIndex: 'messages_processed',
      key: 'messages_processed',
      width: 120
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          {record.status === 'running' ? (
            <Button
              type="link"
              icon={<StopOutlined />}
              onClick={() => handleStop(record.id)}
            >
              停止
            </Button>
          ) : (
            <Button
              type="link"
              icon={<PlayCircleOutlined />}
              onClick={() => handleStart(record.id)}
            >
              启动
            </Button>
          )}
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
        title="流处理管道管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModal(true)}>
            创建管道
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={pipelines}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="创建流处理管道"
        open={createModal}
        onCancel={() => setCreateModal(false)}
        onOk={() => form.submit()}
        width={800}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="name"
            label="管道名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如: etl_user_events" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="source_topic"
                label="源Topic"
                rules={[{ required: true, message: '请输入源Topic' }]}
              >
                <Input placeholder="输入Topic" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="target_topic"
                label="目标Topic"
                rules={[{ required: true, message: '请输入目标Topic' }]}
              >
                <Input placeholder="输出Topic" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="转换配置">
            <Space>
              <Form.Item name="transform_type" noStyle>
                <Select placeholder="转换类型" style={{ width: 150 }}>
                  <Option value="passthrough">透传</Option>
                  <Option value="json_filter">JSON过滤</Option>
                  <Option value="json_map">JSON映射</Option>
                </Select>
              </Form.Item>
              <Form.Item name="transform_expression" noStyle>
                <Input placeholder="转换表达式" style={{ width: 200 }} />
              </Form.Item>
            </Space>
          </Form.Item>

          <Form.Item label="窗口配置">
            <Space wrap>
              <Form.Item name="window_type" noStyle>
                <Select placeholder="窗口类型" style={{ width: 120 }}>
                  <Option value="tumbling">滚动窗口</Option>
                  <Option value="sliding">滑动窗口</Option>
                  <Option value="session">会话窗口</Option>
                </Select>
              </Form.Item>
              <Form.Item name="window_size_ms" noStyle>
                <InputNumber placeholder="大小(ms)" style={{ width: 100 }} />
              </Form.Item>
              <Form.Item name="window_slide_ms" noStyle>
                <InputNumber placeholder="滑动(ms)" style={{ width: 100 }} />
              </Form.Item>
              <Form.Item name="window_gap_ms" noStyle>
                <InputNumber placeholder="间隔(ms)" style={{ width: 100 }} />
              </Form.Item>
            </Space>
          </Form.Item>

          <Form.Item label="Exactly-Once语义">
            <Space>
              <Form.Item name="exactly_once" noStyle valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="transactional_id" noStyle>
                <Input placeholder="事务ID" style={{ width: 200 }} />
              </Form.Item>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Pipelines
