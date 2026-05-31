import React, { useState, useCallback } from 'react';
import { Button, Slider, Space, Typography, Spin, message, Modal, InputNumber } from 'antd';
import { ThunderboltOutlined, CheckOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import useStore from '../store';

const { Title, Text } = Typography;

function BeatDetectionPanel({ scoreId, currentPage, onDetectComplete }) {
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedMarks, setEditedMarks] = useState([]);
  const [timeSignature, setTimeSignature] = useState({ numerator: 4, denominator: 4 });

  const handleDetectBeats = async () => {
    setDetecting(true);
    try {
      const res = await axios.post(`/api/scores/${scoreId}/beats/${currentPage}/detect`);
      setDetectionResult(res.data);
      setEditedMarks([...res.data.marks]);
      setTimeSignature(res.data.timeSignature);
      message.success('节拍识别完成');
      setShowConfirm(true);
    } catch (error) {
      message.error('节拍识别失败: ' + (error.response?.data?.message || error.message));
    }
    setDetecting(false);
  };

  const handleApplyMarks = async () => {
    setLoading(true);
    try {
      await axios.post(`/api/scores/${scoreId}/beats/${currentPage}/apply`, {
        marks: editedMarks,
        timeSignature
      });
      message.success('节拍标记已应用');
      setShowConfirm(false);
      setDetectionResult(null);
      if (onDetectComplete) {
        onDetectComplete();
      }
    } catch (error) {
      message.error('应用节拍标记失败: ' + (error.response?.data?.message || error.message));
    }
    setLoading(false);
  };

  const updateMarkPosition = (index, field, value) => {
    const newMarks = [...editedMarks];
    newMarks[index] = { ...newMarks[index], [field]: value };
    setEditedMarks(newMarks);
  };

  const updateTimeSignature = (field, value) => {
    setTimeSignature(prev => ({ ...prev, [field]: value }));
  };

  const adjustAllY = (value) => {
    const newMarks = editedMarks.map(mark => ({
      ...mark,
      y: value
    }));
    setEditedMarks(newMarks);
  };

  const adjustSpacing = (value) => {
    const groupedMarks = {};
    editedMarks.forEach(mark => {
      if (!groupedMarks[mark.barNumber]) {
        groupedMarks[mark.barNumber] = [];
      }
      groupedMarks[mark.barNumber].push(mark);
    });

    const newMarks = [];
    const beatsPerBar = timeSignature.numerator;
    let currentX = 100;

    Object.keys(groupedMarks).sort((a, b) => a - b).forEach(barNum => {
      const marksInBar = groupedMarks[barNum];
      const beatSpacing = value / beatsPerBar;

      marksInBar.forEach((mark, idx) => {
        newMarks.push({
          ...mark,
          x: currentX + idx * beatSpacing
        });
      });
      currentX += value;
    });

    setEditedMarks(newMarks);
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <Space direction="vertical" size="middle" className="w-full">
        <div className="flex items-center justify-between">
          <Title level={5} className="mb-0">
            <ThunderboltOutlined className="text-blue-500 mr-2" />
            AI 节拍识别
          </Title>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={detecting}
            onClick={handleDetectBeats}
          >
            识别节拍
          </Button>
        </div>

        <Text type="secondary" className="text-sm">
          自动识别乐谱中的小节线和拍号，生成节拍标记。支持手动调整位置。
        </Text>

        {detectionResult && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <Text strong>识别结果</Text>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => setEditMode(!editMode)}
                type={editMode ? "primary" : "default"}
              >
                {editMode ? "完成编辑" : "编辑标记"}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <Text type="secondary" className="text-xs">拍号</Text>
                <div className="flex items-center gap-2 mt-1">
                  <InputNumber
                    min={1}
                    max={16}
                    value={timeSignature.numerator}
                    onChange={(v) => updateTimeSignature('numerator', v)}
                    disabled={!editMode}
                    size="small"
                    style={{ width: 60 }}
                  />
                  <Text>/</Text>
                  <InputNumber
                    min={1}
                    max={16}
                    value={timeSignature.denominator}
                    onChange={(v) => updateTimeSignature('denominator', v)}
                    disabled={!editMode}
                    size="small"
                    style={{ width: 60 }}
                  />
                </div>
              </div>
              <div>
                <Text type="secondary" className="text-xs">识别到的小节数</Text>
                <div className="text-lg font-bold">{detectionResult.barCount}</div>
              </div>
              <div>
                <Text type="secondary" className="text-xs">五线谱组数</Text>
                <div className="text-lg font-bold">{detectionResult.staffCount}</div>
              </div>
              <div>
                <Text type="secondary" className="text-xs">节拍标记数</Text>
                <div className="text-lg font-bold">{editedMarks.length}</div>
              </div>
            </div>

            {editMode && (
              <div className="mb-4 p-3 bg-white rounded border">
                <Text strong className="block mb-3">批量调整</Text>
                <div className="space-y-4">
                  <div>
                    <Text type="secondary" className="text-xs block mb-2">
                      垂直位置 (Y 坐标)
                    </Text>
                    <Slider
                      min={0}
                      max={800}
                      value={editedMarks[0]?.y || 100}
                      onChange={adjustAllY}
                    />
                  </div>
                  <div>
                    <Text type="secondary" className="text-xs block mb-2">
                      小节间距
                    </Text>
                    <Slider
                      min={50}
                      max={200}
                      value={100}
                      onChange={adjustSpacing}
                    />
                  </div>
                </div>
              </div>
            )}

            <Button
              type="primary"
              block
              icon={<CheckOutlined />}
              loading={loading}
              onClick={handleApplyMarks}
              size="large"
            >
              应用节拍标记
            </Button>
          </div>
        )}
      </Space>
    </div>
  );
}

export default BeatDetectionPanel;
