import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { observer } from 'mobx-react-lite';
import {
  Table,
  Button,
  Typography,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Popconfirm,
  message,
  Drawer,
  Card,
  List,
  Switch,
  Divider,
  Descriptions,
  Tabs,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  UndoOutlined,
  RedoOutlined,
  CodeOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import Layout from '@/components/Layout';
import { api } from '@/services/api';

const { Title, Text } = Typography;

const NODE_TYPES = [
  { value: 'start', label: 'Start Event', icon: '⭕' },
  { value: 'end', label: 'End Event', icon: '🟥' },
  { value: 'userTask', label: 'User Task', icon: '👤' },
  { value: 'serviceTask', label: 'Service Task', icon: '⚙️' },
  { value: 'exclusiveGateway', label: 'Exclusive Gateway', icon: '🔶' },
  { value: 'parallelGateway', label: 'Parallel Gateway', icon: '➕' },
  { value: 'inclusiveGateway', label: 'Inclusive Gateway', icon: '🔷' },
];

function WorkflowsPage() {
  const router = useRouter();
  const { appId } = router.query;
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [designerVisible, setDesignerVisible] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<any>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<any>(null);
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('definitions');

  const loadWorkflows = async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const [wfRes, instRes] = await Promise.all([
        api.workflows.list(appId as string),
        api.workflows.listInstances(appId as string),
      ]);
      setWorkflows(wfRes.data);
      setInstances(instRes.data);
    } catch (error) {
      message.error('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkflows();
  }, [appId]);

  const handleCreate = async (values: any) => {
    if (!appId) return;
    try {
      if (editingWorkflow) {
        await api.workflows.update(editingWorkflow.id, values);
        message.success('Workflow updated');
      } else {
        await api.workflows.create(appId as string, values);
        message.success('Workflow created');
      }
      setModalVisible(false);
      form.resetFields();
      setEditingWorkflow(null);
      loadWorkflows();
    } catch (error) {
      message.error('Failed to save workflow');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.workflows.delete(id);
      message.success('Workflow deleted');
      loadWorkflows();
    } catch (error) {
      message.error('Failed to delete workflow');
    }
  };

  const handleStartInstance = async (id: string) => {
    try {
      await api.workflows.startInstance(id, {});
      message.success('Workflow instance started');
      loadWorkflows();
    } catch (error) {
      message.error('Failed to start instance');
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Tag color="purple">{name}</Tag>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (d?: string) => d || '-',
    },
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'default'}>
          {active ? 'Active' : 'Draft'}
        </Tag>
      ),
    },
    {
      title: 'Nodes',
      dataIndex: 'nodes',
      key: 'nodes',
      render: (nodes: any[]) => nodes?.length || 0,
    },
    {
      title: 'Updated',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: any) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingWorkflow(record);
              form.setFieldsValue(record);
              setModalVisible(true);
            }}
          />
          <Button
            type="link"
            icon={<SettingOutlined />}
            onClick={() => {
              setSelectedWorkflow(record);
              setDesignerVisible(true);
            }}
          >
            Design
          </Button>
          <Button
            type="link"
            icon={<PlayCircleOutlined />}
            onClick={() => handleStartInstance(record.id)}
            disabled={!record.isActive}
          >
            Run
          </Button>
          <Button
            type="link"
            icon={<CodeOutlined />}
            onClick={() => {
              setSelectedWorkflow(record);
              setDetailVisible(true);
            }}
          />
          <Popconfirm
            title="Delete workflow?"
            onConfirm={() => handleDelete(record.id)}
            okType="danger"
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const instanceColumns = [
    {
      title: 'Workflow',
      dataIndex: ['workflowDefinition', 'name'],
      key: 'workflow',
      render: (name: string) => <Tag color="purple">{name}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag
          color={
            status === 'running'
              ? 'blue'
              : status === 'completed'
              ? 'green'
              : status === 'failed'
              ? 'red'
              : 'default'
          }
        >
          {status}
        </Tag>
      ),
    },
    {
      title: 'Started At',
      dataIndex: 'startedAt',
      key: 'startedAt',
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: 'Completed At',
      dataIndex: 'completedAt',
      key: 'completedAt',
      render: (date?: string) =>
        date ? new Date(date).toLocaleString() : '-',
    },
  ];

  return (
    <Layout appId={appId as string}>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Title level={2} style={{ margin: 0 }}>
            Workflows
          </Title>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingWorkflow(null);
              form.resetFields();
              setModalVisible(true);
            }}
          >
            New Workflow
          </Button>
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'definitions',
            label: 'Definitions',
            children: (
              <Table
                columns={columns}
                dataSource={workflows}
                rowKey="id"
                loading={loading}
              />
            ),
          },
          {
            key: 'instances',
            label: 'Running Instances',
            children: (
              <Table
                columns={instanceColumns}
                dataSource={instances}
                rowKey="id"
                loading={loading}
              />
            ),
          },
        ]}
      />

      <Modal
        title={editingWorkflow ? 'Edit Workflow' : 'Create Workflow'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingWorkflow(null);
        }}
        onOk={() => form.submit()}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="name"
            label="Workflow Name"
            rules={[{ required: true, message: 'Please enter name' }]}
          >
            <Input placeholder="e.g., OrderApproval, UserRegistration" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Describe this workflow..." />
          </Form.Item>
          <Form.Item
            name="version"
            label="Version"
            initialValue="1.0.0"
          >
            <Input placeholder="1.0.0" />
          </Form.Item>
          <Form.Item
            name="isActive"
            label="Active"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="Workflow Definition"
        placement="right"
        onClose={() => setDetailVisible(false)}
        open={detailVisible}
        width={600}
      >
        {selectedWorkflow && (
          <div>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Name">
                {selectedWorkflow.name}
              </Descriptions.Item>
              <Descriptions.Item label="Version">
                {selectedWorkflow.version}
              </Descriptions.Item>
              <Descriptions.Item label="Description">
                {selectedWorkflow.description || '-'}
              </Descriptions.Item>
            </Descriptions>
            <Divider>Nodes</Divider>
            {selectedWorkflow.nodes?.length === 0 ? (
              <Text type="secondary">No nodes defined</Text>
            ) : (
              <List
                dataSource={selectedWorkflow.nodes}
                renderItem={(item: any) => (
                  <List.Item>
                    <Space>
                      <span style={{ fontSize: 18 }}>
                        {NODE_TYPES.find((t) => t.value === item.type)?.icon || '◼️'}
                      </span>
                      <Tag>{item.type}</Tag>
                      <Text strong>{item.name}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
            <Divider>JSON Definition</Divider>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(selectedWorkflow.definition || {}, null, 2)}
            </pre>
          </div>
        )}
      </Drawer>

      <Modal
        title="Workflow Designer"
        open={designerVisible}
        onCancel={() => setDesignerVisible(false)}
        width={1000}
        footer={[
          <Button key="cancel" onClick={() => setDesignerVisible(false)}>
            Close
          </Button>,
          <Button
            key="save"
            type="primary"
            onClick={() => {
              message.success('Workflow saved');
              setDesignerVisible(false);
              loadWorkflows();
            }}
          >
            Save
          </Button>,
        ]}
      >
        <Card size="small">
          <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
            <Text strong>Drag and drop nodes to design your workflow</Text>
            <Space>
              <Button icon={<UndoOutlined />}>Undo</Button>
              <Button icon={<RedoOutlined />}>Redo</Button>
            </Space>
          </Space>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ width: 180 }}>
              <Text strong>Node Palette</Text>
              <Divider style={{ margin: '8px 0' }} />
              <Space direction="vertical" style={{ width: '100%' }}>
                {NODE_TYPES.map((type) => (
                  <Card
                    key={type.value}
                    size="small"
                    hoverable
                    style={{ cursor: 'move' }}
                  >
                    <Space>
                      <span style={{ fontSize: 16 }}>{type.icon}</span>
                      <Text>{type.label}</Text>
                    </Space>
                  </Card>
                ))}
              </Space>
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 400,
                border: '2px dashed #d9d9d9',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#fafafa',
              }}
            >
              <Text type="secondary">
                Workflow canvas - drag nodes here and connect them
              </Text>
            </div>
            <div style={{ width: 200 }}>
              <Text strong>Properties</Text>
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Select a node to edit its properties
              </Text>
            </div>
          </div>
        </Card>
      </Modal>
    </Layout>
  );
}

export default observer(WorkflowsPage);
