import type { AppProps } from 'next/app';
import { ConfigProvider } from 'antd';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import 'antd/dist/reset.css';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { authStore } from '@/stores/auth.store';

function AppContent({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem('token');
    if (token) {
      authStore.setToken(token);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const publicPaths = ['/login', '/register'];
    const isPublic = publicPaths.includes(router.pathname);
    
    if (!authStore.isAuthenticated && !isPublic) {
      router.push('/login');
    }
  }, [mounted, router.pathname, authStore.isAuthenticated]);

  if (!mounted) return null;

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
          borderRadius: 4,
        },
      }}
    >
      <DndProvider backend={HTML5Backend}>
        <Component {...pageProps} />
      </DndProvider>
    </ConfigProvider>
  );
}

export default function App(props: AppProps) {
  return <AppContent {...props} />;
}
