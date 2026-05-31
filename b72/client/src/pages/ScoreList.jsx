import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Upload, message, Empty, Spin, Modal } from 'antd';
import { UploadOutlined, FileTextOutlined, DeleteOutlined, TeamOutlined } from '@ant-design/icons';
import axios from 'axios';
import useStore from '../store';

function ScoreList() {
  const { scores, fetchScores, isLoading, setLoading, user } = useStore();
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  const handleUpload = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name.replace('.pdf', ''));

    setUploading(true);
    try {
      const res = await axios.post('/api/scores', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      message.success('上传成功');
      fetchScores();
    } catch (error) {
      message.error(error.response?.data?.message || '上传失败');
    }
    setUploading(false);
    return false;
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    Modal.confirm({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除吗？',
      onOk: async () => {
        try {
          await axios.delete(`/api/scores/${id}`);
          message.success('删除成功');
          fetchScores();
        } catch (error) {
          message.error('删除失败');
        }
      }
    });
  };

  const getRoleBadge = (score) => {
    const collaborator = score.collaborators.find(c => c.userId._id === user?._id);
    if (!collaborator) return null;

    const roleMap = {
      creator: { text: '创建者', color: 'bg-green-100 text-green-700' },
      editor: { text: '编辑者', color: 'bg-blue-100 text-blue-700' },
      viewer: { text: '只读', color: 'bg-gray-100 text-gray-700' }
    };

    const role = roleMap[collaborator.role];
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${role.color}`}>
        {role.text}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-display text-3xl font-bold text-primary">我的乐谱</h2>
          <p className="text-gray-500 mt-1">管理和协作您的乐谱文件</p>
        </div>
        <Upload
          accept=".pdf"
          beforeUpload={handleUpload}
          showUploadList={false}
        >
          <Button
            type="primary"
            size="large"
            icon={<UploadOutlined />}
            loading={uploading}
            className="h-12 px-6"
          >
            上传乐谱
          </Button>
        </Upload>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spin size="large" />
        </div>
      ) : scores.length === 0 ? (
        <Empty
          description="暂无乐谱，上传您的第一份乐谱吧！"
          className="py-20"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {scores.map((score) => (
            <Card
              key={score._id}
              hoverable
              onClick={() => navigate(`/score/${score._id}`)}
              className="overflow-hidden transition-all duration-300 hover:shadow-xl"
              actions={[
                <div key="info" className="flex items-center justify-center gap-1 text-gray-500">
                  <FileTextOutlined />
                  <span>{score.pageCount} 页</span>
                </div>,
                <div key="collab" className="flex items-center justify-center gap-1 text-gray-500">
                  <TeamOutlined />
                  <span>{score.collaborators.length} 人</span>
                </div>,
                score.collaborators.find(c => c.userId._id === user?._id)?.role === 'creator' && (
                  <Button
                    key="delete"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => handleDelete(score._id, e)}
                  >
                    删除
                  </Button>
                )
              ].filter(Boolean)}
            >
              <Card.Meta
                avatar={
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                    <FileTextOutlined className="text-2xl text-primary" />
                  </div>
                }
                title={
                  <div className="flex items-center justify-between">
                    <span className="font-semibold truncate max-w-[180px]">
                      {score.title}
                    </span>
                    {getRoleBadge(score)}
                  </div>
                }
                description={
                  <div className="text-sm text-gray-500 mt-2">
                    <div>文件大小: {(score.fileSize / 1024 / 1024).toFixed(2)} MB</div>
                    <div>创建于: {new Date(score.createdAt).toLocaleDateString()}</div>
                  </div>
                }
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default ScoreList;
