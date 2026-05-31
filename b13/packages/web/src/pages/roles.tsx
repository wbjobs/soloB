import { useState, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Table,
  Button,
  Typography,
  Space,
  Modal,
  Form,
  Input,
  Tag,
  Popconfirm,
  message,
  Spin,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import Layout from '@/components/Layout';
import { api } from '@/services/api';
import { authStore } from '@/stores/auth.store';

const { Title, Text } = Typography;

interface Role {
  id: string;
  name: string;
  description?: string;
  permissions: any[];
  users: { id: string; username: string }[];
  createdAt: string;
}

function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [form] = Form.useForm();

  const loadRoles = async () => {
    setLoading(true);
    try {
      const response = await api.roles.list();
      setRoles(response.data);
    } catch (error) {
      message.error('Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
  }, []);

  const handleSubmit = async (values: any) => {
    try {
      if (editingRole) {
        await api.roles.update(editingRole.id, values);
        message.success('Role updated');
      } else {
        await api.roles.create(values);
        message.success('Role created');
      }
      setModalVisible(false);
      form.resetFields();
      setEditingRole(null);
      loadRoles();
    } catch (error) {
      message.error('Failed to save role');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.roles.delete(id);
      message.success('Role deleted');
      loadRoles();
    } catch (error) {
      message.error('Failed to delete role');
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
      render: (desc?: string) => desc || '-',
    },
    {
      title: 'Permissions',
      dataIndex: 'permissions',
      key: 'permissions',
      render: (perms: any[]) => (
        <Text type="secondary">
          {perms.length} permission{perms.length !== 1 ? 's' : ''}
        </Text>
      ),
    },
    {
      title: 'Users',
      dataIndex: 'users',
      key: 'users',
      render: (users: any[]) => (
        <Text type="secondary">
          {users.length} user{users.length !== 1 ? 's' : ''}
        </Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: Role) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedRole(record);
              setDetailVisible(true);
            }}
          />
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingRole(record);
              form.setFieldsValue({
                name: record.name,
                description: record.description,
                permissions: record.permissions,
              });
              setModalVisible(true);
            }}
          />
          {record.name !== 'admin' && authStore.isAdmin && (
            <Popconfirm
              title="Delete role?"
              onConfirm={() => handleDelete(record.id)}
              okType="danger"
            >
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Title level={2} style={{ margin: 0 }}>
            Roles
          </Title>
          {authStore.isAdmin && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingRole(null);
                form.resetFields();
                setModalVisible(true);
              }}
            >
              New Role
            </Button>
          )}
        </Space>
      </div>

      <Spin spinning={loading}>
        <Table columns={columns} dataSource={roles} rowKey="id" />
      </Spin>

      <Modal
        title={editingRole ? 'Edit Role' : 'Create Role'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingRole(null);
        }}
        onOk={() => form.submit()}
        okText={editingRole ? 'Update' : 'Create'}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="Role Name"
            rules={[{ required: true, message: 'Please enter role name' }]}
          >
            <Input placeholder="e.g., editor, viewer" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="Describe this role..." />
          </Form.Item>
          <Form.Item
            name="permissions"
            label="Permissions"
            rules={[{ required: true, message: 'Please define permissions' }]}
          >
            <Input.TextArea
              rows={4}
              placeholder='[{"resource": "page", "action": "read"}]'
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Role Details"
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={600}
      >
        {selectedRole && (
          <div>
            <p><strong>Name:</strong> {selectedRole.name}</p>
            <p><strong>Description:</strong> {selectedRole.description || '-'}</p>
            <p><strong>Permissions:</strong></p>
            <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>
              {JSON.stringify(selectedRole.permissions, null, 2)}
            </pre>
            <p><strong>Users:</strong></p>
            <Space wrap>
              {selectedRole.users.map((u) => (
                <Tag key={u.id}>{u.username}</Tag>
              ))}
            </Space>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

export default observer(RolesPage);
