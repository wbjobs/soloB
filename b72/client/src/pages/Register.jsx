import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, message, Card } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import axios from 'axios';
import useStore from '../store';

function Register() {
  const [loading, setLoading] = useState(false);
  const { setToken, setUser } = useStore();
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/register', values);
      setToken(res.data.token);
      setUser(res.data.user);
      message.success('注册成功');
      navigate('/');
    } catch (error) {
      message.error(error.response?.data?.message || '注册失败');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md shadow-xl">
        <div className="text-center mb-8">
        <h2 className="font-display text-3xl font-bold text-primary mb-2">创建账户</h2>
        <p className="text-gray-500">注册以开始使用乐谱协同批注</p>
      </div>

      <Form
        name="register"
        onFinish={onFinish}
        autoComplete="off"
        size="large"
      >
        <Form.Item
          name="name"
          rules={[
            { required: true, message: '请输入姓名' },
            { min: 2, message: '姓名至少2个字符' }
          ]}
        >
          <Input
            prefix={<UserOutlined />}
            placeholder="姓名"
          />
        </Form.Item>

        <Form.Item
          name="email"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '请输入有效的邮箱地址' }
          ]}
        >
          <Input
            prefix={<MailOutlined />}
            placeholder="邮箱地址"
          />
        </Form.Item>

        <Form.Item
          name="password"
          rules={[
            { required: true, message: '请输入密码' },
            { min: 6, message: '密码至少6位' }
          ]}
        >
          <Input.Password
            prefix={<LockOutlined />}
            placeholder="密码"
          />
        </Form.Item>

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            className="w-full h-12 text-lg"
          >
            注册
          </Button>
        </Form.Item>

        <div className="text-center">
          已有账户？
          <Link to="/login" className="text-primary font-medium hover:underline ml-1">
            立即登录
          </Link>
        </div>
      </Form>
    </Card>
    </div>
  );
}

export default Register;
