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
  Tabs,
  Descriptions,
  Divider,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
  LinkOutlined,
  DatabaseOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import Layout from '@/components/Layout';
import { api } from '@/services/api';
import { FieldType, RelationType } from '@lowcode/shared';

const { Title, Text } = Typography;

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'String', label: 'String' },
  { value: 'Int', label: 'Integer' },
  { value: 'Float', label: 'Float' },
  { value: 'Boolean', label: 'Boolean' },
  { value: 'DateTime', label: 'DateTime' },
  { value: 'Json', label: 'JSON' },
  { value: 'Text', label: 'Text' },
  { value: 'Decimal', label: 'Decimal' },
];

const RELATION_TYPES: { value: RelationType; label: string }[] = [
  { value: 'one-to-one', label: 'One to One' },
  { value: 'one-to-many', label: 'One to Many' },
  { value: 'many-to-one', label: 'Many to One' },
  { value: 'many-to-many', label: 'Many to Many' },
];

function DataModelsPage() {
  const router = useRouter();
  const { appId } = router.query;
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [selectedModel, setSelectedModel] = useState<any>(null);
  const [previewCode, setPreviewCode] = useState('');
  const [editingModel, setEditingModel] = useState<any>(null);
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('fields');

  const loadModels = async () => {
    if (!appId) return;
    setLoading(true);
    try {
      const response = await api.dataModels.list(appId as string);
      setModels(response.data);
    } catch (error) {
      message.error('Failed to load data models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModels();
  }, [appId]);

  const handleCreate = async (values: any) => {
    if (!appId) return;
    try {
      if (editingModel) {
        await api.dataModels.update(editingModel.id, values);
        message.success('Model updated');
      } else {
        await api.dataModels.create(appId as string, values);
        message.success('Model created');
      }
      setModalVisible(false);
      form.resetFields();
      setEditingModel(null);
      loadModels();
    } catch (error) {
      message.error('Failed to save model');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.dataModels.delete(id);
      message.success('Model deleted');
      loadModels();
    } catch (error) {
      message.error('Failed to delete model');
    }
  };

  const handlePreview = async (id: string) => {
    try {
      const response = await api.dataModels.preview(id);
      setPreviewCode(response.data.prismaSchema);
      setPreviewVisible(true);
    } catch (error) {
      message.error('Failed to generate preview');
    }
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Tag color="blue">{name}</Tag>,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (d?: string) => d || '-',
    },
    {
      title: 'Fields',
      dataIndex: 'fields',
      key: 'fields',
      render: (fields: any[]) => fields?.length || 0,
    },
    {
      title: 'Relations',
      dataIndex: 'relations',
      key: 'relations',
      render: (relations: any[]) => relations?.length || 0,
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
              setEditingModel(record);
              form.setFieldsValue(record);
              setModalVisible(true);
            }}
          />
          <Button
            type="link"
            icon={<DatabaseOutlined />}
            onClick={() => {
              setSelectedModel(record);
              setDetailVisible(true);
            }}
          />
          <Button
            type="link"
            icon={<CodeOutlined />}
            onClick={() => handlePreview(record.id)}
          />
          <Popconfirm
            title="Delete model?"
            onConfirm={() => handleDelete(record.id)}
            okType="danger"
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const fieldColumns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => <Tag>{type}</Tag>,
    },
    {
      title: 'Required',
      dataIndex: 'isRequired',
      key: 'isRequired',
      render: (v: boolean) => (v ? 'Yes' : 'No'),
    },
    {
      title: 'Unique',
      dataIndex: 'isUnique',
      key: 'isUnique',
      render: (v: boolean) => (v ? 'Yes' : 'No'),
    },
    {
      title: 'Primary Key',
      dataIndex: 'isPrimaryKey',
      key: 'isPrimaryKey',
      render: (v: boolean) => v && <KeyOutlined />,
    },
  ];

  return (
    <Layout appId={appId as string}>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Title level={2} style={{ margin: 0 }}>
            Data Models
          </Title>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingModel(null);
              form.resetFields();
              setModalVisible(true);
            }}
          >
            New Model
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={models}
        rowKey="id"
        loading={loading}
      />

      <Modal
        title={editingModel ? 'Edit Data Model' : 'Create Data Model'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingModel(null);
        }}
        onOk={() => form.submit()}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="name"
            label="Model Name"
            rules={[{ required: true, message: 'Please enter model name' }]}
          >
            <Input placeholder="e.g., User, Product, Order" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Describe this model..." />
          </Form.Item>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'fields',
                label: 'Fields',
                children: (
                  <Form.List name="fields">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, fieldKey, ...restField }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 8 }}
                            extra={
                              <Button
                                type="link"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => remove(name)}
                              />
                            }
                          >
                            <Space wrap>
                              <Form.Item
                                {...restField}
                                name={[name, 'name']}
                                fieldKey={[fieldKey, 'name']}
                                rules={[{ required: true, message: 'Required' }]}
                                style={{ marginBottom: 0, minWidth: 120 }}
                              >
                                <Input placeholder="Name" />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'type']}
                                fieldKey={[fieldKey, 'type']}
                                rules={[{ required: true, message: 'Required' }]}
                                style={{ marginBottom: 0 }}
                              >
                                <Select
                                  style={{ width: 120 }}
                                  options={FIELD_TYPES}
                                />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'isRequired']}
                                fieldKey={[fieldKey, 'isRequired']}
                                valuePropName="checked"
                                style={{ marginBottom: 0 }}
                              >
                                <Switch checkedChildren="Required" unCheckedChildren="Null" />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'isUnique']}
                                fieldKey={[fieldKey, 'isUnique']}
                                valuePropName="checked"
                                style={{ marginBottom: 0 }}
                              >
                                <Switch checkedChildren="Unique" unCheckedChildren="No" />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'isPrimaryKey']}
                                fieldKey={[fieldKey, 'isPrimaryKey']}
                                valuePropName="checked"
                                style={{ marginBottom: 0 }}
                              >
                                <Switch checkedChildren={<KeyOutlined />} unCheckedChildren="No" />
                              </Form.Item>
                            </Space>
                          </Card>
                        ))}
                        <Button
                          type="dashed"
                          onClick={() => add({ name: '', type: 'String', isRequired: false })}
                          block
                          icon={<PlusOutlined />}
                        >
                          Add Field
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
              {
                key: 'relations',
                label: 'Relations',
                children: (
                  <Form.List name="relations">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, fieldKey, ...restField }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 8 }}
                            extra={
                              <Button
                                type="link"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => remove(name)}
                              />
                            }
                          >
                            <Space wrap>
                              <Form.Item
                                {...restField}
                                name={[name, 'name']}
                                fieldKey={[fieldKey, 'name']}
                                style={{ marginBottom: 0, minWidth: 120 }}
                              >
                                <Input placeholder="Relation name" />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'type']}
                                fieldKey={[fieldKey, 'type']}
                                style={{ marginBottom: 0 }}
                              >
                                <Select
                                  style={{ width: 150 }}
                                  options={RELATION_TYPES}
                                />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'targetModel']}
                                fieldKey={[fieldKey, 'targetModel']}
                                style={{ marginBottom: 0 }}
                              >
                                <Select
                                  style={{ width: 150 }}
                                  placeholder="Target model"
                                  options={models.map((m) => ({ value: m.name, label: m.name }))}
                                />
                              </Form.Item>
                            </Space>
                          </Card>
                        ))}
                        <Button
                          type="dashed"
                          onClick={() => add({ name: '', type: 'one-to-many' })}
                          block
                          icon={<LinkOutlined />}
                        >
                          Add Relation
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      <Drawer
        title="Model Details"
        placement="right"
        onClose={() => setDetailVisible(false)}
        open={detailVisible}
        width={600}
      >
        {selectedModel && (
          <div>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Name">
                {selectedModel.name}
              </Descriptions.Item>
              <Descriptions.Item label="Description">
                {selectedModel.description || '-'}
              </Descriptions.Item>
            </Descriptions>
            <Divider>Fields</Divider>
            <Table
              columns={fieldColumns}
              dataSource={selectedModel.fields}
              rowKey="id"
              pagination={false}
              size="small"
            />
            <Divider>Relations</Divider>
            {selectedModel.relations?.length === 0 ? (
              <Text type="secondary">No relations</Text>
            ) : (
              <List
                dataSource={selectedModel.relations}
                renderItem={(item: any) => (
                  <List.Item>
                    <Space>
                      <Tag>{item.type}</Tag>
                      <Text>{item.name} → {item.targetModel}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </div>
        )}
      </Drawer>

      <Modal
        title="Prisma Schema Preview"
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={800}
      >
        <pre
          style={{
            background: '#f5f5f5',
            padding: 16,
            borderRadius: 4,
            overflow: 'auto',
            maxHeight: 500,
          }}
        >
          {previewCode}
        </pre>
      </Modal>
    </Layout>
  );
}

export default observer(DataModelsPage);
