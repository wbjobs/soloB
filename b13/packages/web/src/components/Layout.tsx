import { useState } from 'react';
import { useRouter } from 'next/router';
import { observer } from 'mobx-react-lite';
import { Layout as AntLayout, Menu, Dropdown, Avatar, Button, Typography } from 'antd';
import {
  AppstoreOutlined,
  UnorderedListOutlined,
  TableOutlined,
  ProjectOutlined,
  SettingOutlined,
  UserOutlined,
  LogoutOutlined,
  TeamOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { authStore } from '@/stores/auth.store';

const { Header, Sider, Content } = AntLayout;
const { Text } = Typography;

interface LayoutProps {
  children: React.ReactNode;
  appId?: string;
}

function Layout({ children, appId }: LayoutProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    authStore.logout();
    router.push('/login');
  };

  const userMenu = {
    items: [
      {
        key: 'profile',
        icon: <UserOutlined />,
        label: 'Profile',
      },
      {
        key: 'settings',
        icon: <SettingOutlined />,
        label: 'Settings',
      },
      { type: 'divider' },
      {
        key: 'logout',
        icon: <LogoutOutlined />,
        label: 'Logout',
        onClick: handleLogout,
      },
    ],
  };

  const mainMenuItems = [
    {
      key: '/',
      icon: <AppstoreOutlined />,
      label: 'Applications',
      onClick: () => router.push('/'),
    },
    {
      key: '/users',
      icon: <TeamOutlined />,
      label: 'Users',
      onClick: () => router.push('/users'),
    },
    {
      key: '/roles',
      icon: <SafetyOutlined />,
      label: 'Roles',
      onClick: () => router.push('/roles'),
    },
  ];

  const appMenuItems = appId
    ? [
        {
          key: `/applications/${appId}`,
          icon: <UnorderedListOutlined />,
          label: 'Pages',
          onClick: () => router.push(`/applications/${appId}`),
        },
        {
          key: `/applications/${appId}/data-models`,
          icon: <TableOutlined />,
          label: 'Data Models',
          onClick: () => router.push(`/applications/${appId}/data-models`),
        },
        {
          key: `/applications/${appId}/workflows`,
          icon: <ProjectOutlined />,
          label: 'Workflows',
          onClick: () => router.push(`/applications/${appId}/workflows`),
        },
      ]
    : [];

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        width={240}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1890ff',
            color: 'white',
            fontWeight: 'bold',
            fontSize: collapsed ? 14 : 20,
          }}
        >
          {collapsed ? 'LC' : 'Low-Code'}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[router.pathname]}
          items={mainMenuItems}
        />

        {appMenuItems.length > 0 && (
          <>
            <div style={{ height: 1, background: '#f0f0f0', margin: '8px 0' }} />
            <Menu
              mode="inline"
              selectedKeys={[router.pathname]}
              items={appMenuItems}
            />
          </>
        )}
      </Sider>

      <AntLayout>
        <Header
          style={{
            background: 'white',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
          }}
        >
          <Dropdown menu={userMenu} placement="bottomRight">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
              }}
            >
              <Avatar icon={<UserOutlined />} />
              <Text strong>{authStore.user?.username || authStore.user?.email}</Text>
            </div>
          </Dropdown>
        </Header>

        <Content
          style={{
            margin: 24,
            padding: 24,
            background: 'white',
            minHeight: 280,
            borderRadius: 8,
          }}
        >
          {children}
        </Content>
      </AntLayout>
    </AntLayout>
  );
}

export default observer(Layout);
