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
  Empty,
  Spin,
  message,
  Popconfirm,
  Tabs,
  Table,
  Select,
  Descriptions,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  DownloadOutlined,
  CloudUploadOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import Layout from '@/components/Layout';
import { api } from '@/services/api';

const { Title, Text } = Typography;

interface Application {
  id: string;
  name: string;
  description?: string;
  status: string;
  pages: any[];
  dataModels: any[];
  workflows: any[];
  environments: any[];
  versions: any[];
}

function ApplicationDetailPage() {
  const router = useRouter();
  const { appId } = router.query;
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageModalVisible, setPageModalVisible] = useState(false);
  const [versionModalVisible, setVersionModalVisible] = useState(false);
  const [deployModalVisible, setDeployModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [deployForm] = Form.useForm();
  const [versionForm] = Form.useForm();

  const loadApplication = async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const response = await api.applications.get(appId as string);
      setApplication(response.data);
    } catch (error) {
      message.error('Failed to load application');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadApplication();
  }, [appId]);

  const handleCreatePage = async (values: { name: string; path: string }) => {
    if (!appId) return;
    try {
      await api.pages.create(appId as string, values);
      message.success('Page created');
      setPageModalVisible(false);
      form.resetFields();
      loadApplication();
    } catch (error) {
      message.error('Failed to create page');
    }
  };

  const handleCreateVersion = async (values: { version: string; description?: string }) => {
    if (!appId) return;
    try {
      await api.applications.createVersion(appId as string, values);
      message.success('Version created');
      setVersionModalVisible(false);
      versionForm.resetFields();
      loadApplication();
    } catch (error) {
      message.error('Failed to create version');
    }
  };

  const handleDeploy = async (values: { versionId: string; environmentId: string }) => {
    if (!appId) return;
    try {
      await api.applications.deploy(appId as string, values);
      message.success('Deployment started');
      setDeployModalVisible(false);
      deployForm.resetFields();
      loadApplication();
    } catch (error) {
      message.error('Failed to deploy');
    }
  };

  const handleDeletePage = async (pageId: string) => {
    try {
      await api.pages.delete(pageId);
      message.success('Page deleted');
      loadApplication();
    } catch (error) {
      message.error('Failed to delete page');
    }
  };

  const handleDownloadCode = async () => {
    if (!appId) return;
    try {
      const response = await api.generator.download(appId as string);
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${application?.name || 'app'}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      message.success('Code downloaded');
    } catch (error) {
      message.error('Failed to download code');
    }
  };

  const pageColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Path',
      dataIndex: 'path',
      key: 'path',
      render: (path: string) => <Text code>{path}</Text>,
    },
    {
      title: 'Components',
      dataIndex: 'components',
      key: 'components',
      render: (components: any[]) => components?.length || 0,
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
            onClick={() => router.push(`/applications/${appId}/pages/${record.id}`)}
          >
            Edit
          </Button>
          <Button
            type="link"
            icon={<PlayCircleOutlined />}
          >
            Preview
          </Button>
          <Popconfirm
            title="Delete page?"
            onConfirm={() => handleDeletePage(record.id)}
            okType="danger"
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const versionColumns = [
    {
      title: 'Version',
      dataIndex: 'version',
      key: 'version',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (d?: string) => d || '-',
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleString(),
    },
  ];

  if (!application) {
    return <Spin />;
  }

  return (
    <Layout appId={appId as string}>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>
              {application.name}
            </Title>
            <Text type="secondary">
              {application.description || 'No description'}
            </Text>
          </div>
          <Space>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleDownloadCode}
            >
              Download Code
            </Button>
            <Button
              icon={<HistoryOutlined />}
              onClick={() => setVersionModalVisible(true)}
            >
              New Version
            </Button>
            <Button
              type="primary"
              icon={<CloudUploadOutlined />}
              onClick={() => setDeployModalVisible(true)}
            >
              Deploy
            </Button>
          </Space>
        </Space>
      </div>

      <Descriptions bordered size="small" style={{ marginBottom: 24 }}>
        <Descriptions.Item label="Status">
          <Tag
            color={
              application.status === 'active'
                ? 'green'
                : application.status === 'archived'
                ? 'default'
                : 'blue'
            }
          >
            {application.status}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Pages">
          {application.pages?.length || 0}
        </Descriptions.Item>
        <Descriptions.Item label="Data Models">
          {application.dataModels?.length || 0}
        </Descriptions.Item>
        <Descriptions.Item label="Workflows">
          {application.workflows?.length || 0}
        </Descriptions.Item>
        <Descriptions.Item label="Versions">
          {application.versions?.length || 0}
        </Descriptions.Item>
        <Descriptions.Item label="Environments">
          {application.environments?.length || 0}
        </Descriptions.Item>
      </Descriptions>

      <Tabs
        items={[
          {
            key: 'pages',
            label: 'Pages',
            children: (
              <div>
                <Space style={{ marginBottom: 16 }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setPageModalVisible(true)}
                  >
                    New Page
                  </Button>
                </Space>
                {application.pages?.length === 0 ? (
                  <Empty description="No pages yet" style={{ padding: 40 }} />
                ) : (
                  <Table
                    columns={pageColumns}
                    dataSource={application.pages}
                    rowKey="id"
                    pagination={false}
                  />
                )}
              </div>
            ),
          },
          {
            key: 'versions',
            label: 'Versions',
            children: application.versions?.length === 0 ? (
              <Empty description="No versions yet" style={{ padding: 40 }} />
            ) : (
              <Table
                columns={versionColumns}
                dataSource={application.versions}
                rowKey="id"
                pagination={false}
              />
            ),
          },
          {
            key: 'environments',
            label: 'Environments',
            children: application.environments?.length === 0 ? (
              <Empty description="No environments configured" style={{ padding: 40 }} />
            ) : (
              <Space wrap>
                {application.environments?.map((env: any) => (
                  <Card key={env.id} style={{ width: 200 }}>
                    <Card.Meta
                      title={<Tag color={env.name === 'prod' ? 'red' : env.name === 'staging' ? 'orange' : 'green'}>{env.name}</Tag>}
                      description={env.description || '-'}
                    />
                  </Card>
                ))}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="Create Page"
        open={pageModalVisible}
        onCancel={() => setPageModalVisible(false)}
        onOk={() => form.submit()}
        okText="Create"
      >
        <Form form={form} layout="vertical" onFinish={handleCreatePage}>
          <Form.Item
            name="name"
            label="Page Name"
            rules={[{ required: true, message: 'Please enter page name' }]}
          >
            <Input placeholder="Home" />
          </Form.Item>
          <Form.Item
            name="path"
            label="Route Path"
            rules={[{ required: true, message: 'Please enter path' }]}
          >
            <Input prefix="/" placeholder="home" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Create Version"
        open={versionModalVisible}
        onCancel={() => setVersionModalVisible(false)}
        onOk={() => versionForm.submit()}
        okText="Create"
      >
        <Form form={versionForm} layout="vertical" onFinish={handleCreateVersion}>
          <Form.Item
            name="version"
            label="Version Number"
            rules={[{ required: true, message: 'Please enter version' }]}
          >
            <Input placeholder="1.0.0" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="What changed in this version?" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Deploy"
        open={deployModalVisible}
        onCancel={() => setDeployModalVisible(false)}
        onOk={() => deployForm.submit()}
        okText="Deploy"
      >
        <Form form={deployForm} layout="vertical" onFinish={handleDeploy}>
          <Form.Item
            name="versionId"
            label="Version"
            rules={[{ required: true, message: 'Please select version' }]}
          >
            <Select
              placeholder="Select version"
              options={application.versions?.map((v: any) => ({
                value: v.id,
                label: v.version,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="environmentId"
            label="Environment"
            rules={[{ required: true, message: 'Please select environment' }]}
          >
            <Select
              placeholder="Select environment"
              options={application.environments?.map((e: any) => ({
                value: e.id,
                label: e.name,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}

export default observer(ApplicationDetailPage);
