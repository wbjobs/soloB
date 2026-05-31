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
  Select,
  Tag,
  Switch,
  Popconfirm,
  message,
  Spin,
  Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import Layout from '@/components/Layout';
import { api } from '@/services/api';
import { authStore } from '@/stores/auth.store';

const { Title } = Typography;

interface User {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  roles: { id: string; name: string }[];
  createdAt: string;
  lastLoginAt?: string;
}

interface Role {
  id: string;
  name: string;
}

function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        api.users.list(),
        api.roles.list(),
      ]);
      setUsers(usersRes.data);
      setRoles(rolesRes.data);
    } catch (error) {
      message.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async (values: any) => {
    try {
      if (editingUser) {
        await api.users.update(editingUser.id, values);
        message.success('User updated');
      } else {
        await api.users.create(values);
        message.success('User created');
      }
      setModalVisible(false);
      form.resetFields();
      setEditingUser(null);
      loadData();
    } catch (error) {
      message.error('Failed to save user');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.users.delete(id);
      message.success('User deleted');
      loadData();
    } catch (error) {
      message.error('Failed to delete user');
    }
  };

  const handleToggleActive = async (id: string, checked: boolean) => {
    try {
      await api.users.update(id, { isActive: checked });
      message.success('User status updated');
      loadData();
    } catch (error) {
      message.error('Failed to update user');
    }
  };

  const columns = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'Roles',
      dataIndex: 'roles',
      key: 'roles',
      render: (roles: Role[]) => (
        <Space wrap>
          {roles.map((role) => (
            <Tag key={role.id} color="blue">
              {role.name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Active',
      dataIndex: 'isActive',
      key: 'isActive',
      render: (active: boolean, record: User) => (
        <Switch
          checked={active}
          onChange={(checked) => handleToggleActive(record.id, checked)}
          disabled={!authStore.isAdmin}
        />
      ),
    },
    {
      title: 'Last Login',
      dataIndex: 'lastLoginAt',
      key: 'lastLoginAt',
      render: (date?: string) =>
        date ? new Date(date).toLocaleString() : 'Never',
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: User) => (
        <Space>
          <Tooltip title="Edit">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => {
                setEditingUser(record);
                form.setFieldsValue({
                  username: record.username,
                  email: record.email,
                  roleIds: record.roles.map((r) => r.id),
                  isActive: record.isActive,
                });
                setModalVisible(true);
              }}
            />
          </Tooltip>
          <Tooltip title="Delete">
            <Popconfirm
              title="Delete user?"
              onConfirm={() => handleDelete(record.id)}
              okType="danger"
            >
              <Button type="link" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
          <Title level={2} style={{ margin: 0 }}>
            Users
          </Title>
          {authStore.isAdmin && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditingUser(null);
                form.resetFields();
                setModalVisible(true);
              }}
            >
              New User
            </Button>
          )}
        </Space>
      </div>

      <Spin spinning={loading}>
        <Table
          columns={columns}
          dataSource={users}
          rowKey="id"
        />
      </Spin>

      <Modal
        title={editingUser ? 'Edit User' : 'Create User'}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingUser(null);
        }}
        onOk={() => form.submit()}
        okText={editingUser ? 'Update' : 'Create'}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Please enter username' }]}
          >
            <Input placeholder="Username" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Please enter email' },
              { type: 'email', message: 'Invalid email' },
            ]}
          >
            <Input placeholder="email@example.com" />
          </Form.Item>
          {!editingUser && (
            <Form.Item
              name="password"
              label="Password"
              rules={[
                { required: true, message: 'Please enter password' },
                { min: 8, message: 'At least 8 characters' },
              ]}
            >
              <Input.Password placeholder="Password" />
            </Form.Item>
          )}
          <Form.Item
            name="roleIds"
            label="Roles"
            rules={[{ required: true, message: 'Please select at least one role' }]}
          >
            <Select
              mode="multiple"
              placeholder="Select roles"
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
            />
          </Form.Item>
          {editingUser && (
            <Form.Item name="isActive" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Layout>
  );
}

export default observer(UsersPage);
