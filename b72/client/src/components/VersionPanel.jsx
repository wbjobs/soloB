import React from 'react';
import { Button, List, Tag, Empty } from 'antd';
import { RollbackOutlined, UserOutlined } from '@ant-design/icons';

function VersionPanel({ versions, onRestore }) {
  if (versions.length === 0) {
    return <Empty description="暂无历史版本" />;
  }

  return (
    <div className="max-h-[500px] overflow-auto">
      <List
        dataSource={versions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))}
        renderItem={(version, index) => (
          <List.Item
            actions={[
              <Button
                key="restore"
                type="link"
                icon={<RollbackOutlined />}
                onClick={() => onRestore(version._id)}
                size="small"
              >
                恢复
              </Button>
            ]}
          >
            <List.Item.Meta
              avatar={<UserOutlined />}
              title={
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {version.description || `版本 ${versions.length - index}`}
                  </span>
                  {index === 0 && (
                    <Tag color="blue">最新</Tag>
                  )}
                </div>
              }
              description={
                <div className="text-sm text-gray-500">
                  <div>创建者: {version.createdBy?.name || version.createdBy?.email}</div>
                  <div>创建时间: {new Date(version.createdAt).toLocaleString()}</div>
                  <div>包含 {version.snapshot?.length || 0} 个批注</div>
                </div>
              }
            />
          </List.Item>
        )}
      />
    </div>
  );
}

export default VersionPanel;
