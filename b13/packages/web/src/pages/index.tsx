import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { observer } from 'mobx-react-lite';
import {
  Card,
  List,
  Button,
  Typography,
  Space,
  Modal,
  Form,
  Input,
  Tag,
  Tooltip,
  Empty,
  Spin,
  message,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  CloudUploadOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import Layout from '@/components/Layout';
import { api } from '@/services/api';
import { authStore } from '@/stores/auth.store';

const { Title, Text } = Typography;

interface Application {
  id: string;
  name: string;
  description?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function ApplicationsPage() {
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  const loadApplications = async () => {
    setLoading(true);
    try {
      const response = await api.applications.list();
      setApplications(response.data);
    } catch (error) {
      message.error('Failed to load applications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplications();
  }, []);

  const handleCreate = async (values: { name: string; description?: string }) => {
    try {
      await api.applications.create(values);
      message.success('Application created');
      setModalVisible(false);
      form.resetFields();
      loadApplications();
    } catch (error) {
      message.error('Failed to create application');
    }
  };

  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: 'Delete Application',
      content: 'Are you sure you want to delete this application?',
      okType: 'danger',
      onOk: async () => {
        try {
          await api.applications.delete(id);
          message.success('Application deleted');
          loadApplications();
        } catch (error) {
          message.error('Failed to delete application');
        }
      },
    });
  };

  const handleGenerate = async (id: string) => {
    try {
      const response = await api.generator.download(id);
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'generated-app.zip';
      a.click();
      window.URL.revokeObjectURL(url);
      message.success('Code generated and downloaded');
    } catch (error) {
      message.error('Failed to generate code');
    }
  };

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Title level={2} style={{ margin: 0 }}>
            Applications
          </Title>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setModalVisible(true)}
          >
            New Application
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        {applications.length === 0 ? (
          <Empty
            description="No applications yet"
            style={{ padding: '60px 0' }}
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setModalVisible(true)}
            >
              Create Your First Application
            </Button>
          </Empty>
        ) : (
          <List
            grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 4 }}
            dataSource={applications}
            renderItem={(app) => (
              <List.Item>
                <Card
                  hoverable
                  onClick={() => router.push(`/applications/${app.id}`)}
                  style={{ height: '100%' }}
                  actions={[
                    <Tooltip title="Edit">
                      <EditOutlined
                        key="edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/applications/${app.id}`);
                        }}
                      />
                    </Tooltip>,
                    <Tooltip title="Versions">
                      <HistoryOutlined
                        key="versions"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/applications/${app.id}`);
                        }}
                      />
                    </Tooltip>,
                    <Tooltip title="Generate Code">
                      <DownloadOutlined
                        key="generate"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGenerate(app.id);
                        }}
                      />
                    </Tooltip>,
                    authStore.isAdmin ? (
                      <Tooltip title="Delete">
                        <DeleteOutlined
                          key="delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(app.id);
                          }}
                          style={{ color: '#ff4d4f' }}
                        />
                      </Tooltip>
                    ) : null,
                  ]}
                >
                  <Card.Meta
                    title={
                      <Space>
                        {app.name}
                        <Tag
                          color={
                            app.status === 'active'
                              ? 'green'
                              : app.status === 'archived'
                              ? 'default'
                              : 'blue'
                          }
                        >
                          {app.status}
                        </Tag>
                      </Space>
                    }
                    description={
                      <Text type="secondary" ellipsis={{ rows: 2 }}>
                        {app.description || 'No description'}
                      </Text>
                    }
                  />
                  <div style={{ marginTop: 16 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Updated: {new Date(app.updatedAt).toLocaleDateString()}
                    </Text>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        )}
      </Spin>

      <Modal
        title="Create Application"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => form.submit()}
        okText="Create"
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="name"
            label="Application Name"
            rules={[{ required: true, message: 'Please enter name' }]}
          >
            <Input placeholder="My Application" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} placeholder="Describe your application..." />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}

export default observer(ApplicationsPage);
