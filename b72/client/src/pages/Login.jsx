import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, message, Card } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import useStore from '../store';

function Login() {
  const [loading, setLoading] = useState(false);
  const { setToken, setUser } = useStore();
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/login', values);
      setToken(res.data.token);
      setUser(res.data.user);
      message.success('登录成功');
      navigate('/');
    } catch (error) {
      message.error(error.response?.data?.message || '登录失败');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md shadow-xl">
        <div className="text-center mb-8">
          <h2 className="font-display text-3xl font-bold text-primary mb-2">欢迎回来</h2>
          <p className="text-gray-500">登录您的账户以继续</p>
        </div>

        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input
              prefix={<UserOutlined />}
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
              登录
            </Button>
          </Form.Item>

          <div className="text-center">
            还没有账户？
            <Link to="/register" className="text-primary font-medium hover:underline ml-1">
              立即注册
            </Link>
          </div>
        </Form>
      </Card>
    </div>
  );
}

export default Login;
