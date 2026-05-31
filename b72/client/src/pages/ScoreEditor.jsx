import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Spin, message, Button, Modal, Input, Drawer } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, HistoryOutlined, UserOutlined, ThunderboltOutlined } from '@ant-design/icons';
import axios from 'axios';
import * as pdfjsLib from 'pdfjs-dist';
import * as fabric from 'fabric';
import useStore from '../store';
import Toolbar from '../components/Toolbar';
import VersionPanel from '../components/VersionPanel';
import BeatDetectionPanel from '../components/BeatDetectionPanel';
import useSocket from '../hooks/useSocket';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

function ScoreEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    currentScore,
    currentPage,
    setCurrentPage,
    fetchScore,
    fetchAnnotations,
    annotations,
    fetchVersions,
    versions,
    tool,
    color,
    user,
    onlineUsers,
    setOnlineUsers,
    addAnnotation,
    setAnnotations
  } = useStore();

  const [pdfDoc, setPdfDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showVersions, setShowVersions] = useState(false);
  const [showBeatPanel, setShowBeatPanel] = useState(false);
  const [scale, setScale] = useState(1.5);

  const pdfCanvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const fabricInstanceRef = useRef(null);
  const isDrawingRef = useRef(false);
  const currentPathRef = useRef(null);
  const messageQueueRef = useRef([]);
  const lastProcessedMessageIdRef = useRef(0);
  const isProcessingQueueRef = useRef(false);

  const { socket } = useSocket(id);

  useEffect(() => {
    const init = async () => {
      await fetchScore(id);
      await fetchAnnotations(id, 1);
      await fetchVersions(id);
      setLoading(false);
    };
    init();
  }, [id, fetchScore, fetchAnnotations, fetchVersions]);

  useEffect(() => {
    if (!currentScore) return;

    const loadPdf = async () => {
      try {
        const pdf = await pdfjsLib.getDocument(`/uploads/${currentScore.filePath.split('/').pop()}`).promise;
        setPdfDoc(pdf);
      } catch (error) {
        console.error('加载 PDF 失败:', error);
        message.error('加载 PDF 失败');
      }
    };

    loadPdf();
  }, [currentScore]);

  useEffect(() => {
    if (!pdfDoc || !pdfCanvasRef.current) return;

    const renderPage = async () => {
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale });

      pdfCanvasRef.current.width = viewport.width;
      pdfCanvasRef.current.height = viewport.height;

      const renderContext = {
        canvasContext: pdfCanvasRef.current.getContext('2d'),
        viewport
      };

      await page.render(renderContext).promise;

      if (!fabricInstanceRef.current) {
        fabricInstanceRef.current = new fabric.Canvas(fabricCanvasRef.current, {
          width: viewport.width,
          height: viewport.height,
          selection: tool === 'select',
          backgroundColor: 'transparent'
        });

        setupFabricEvents();
      } else {
        fabricInstanceRef.current.setWidth(viewport.width);
        fabricInstanceRef.current.setHeight(viewport.height);
      }

      await fetchAnnotations(id, currentPage);
      loadAnnotations();
    };

    renderPage();
  }, [pdfDoc, currentPage, scale, id, fetchAnnotations]);

  useEffect(() => {
    if (!socket) return;

    socket.on('user-connected', ({ users }) => {
      setOnlineUsers(users);
    });

    socket.on('user-disconnected', ({ users }) => {
      setOnlineUsers(users);
    });

    socket.on('annotation-add', (annotation) => {
      enqueueMessage(annotation);
    });

    return () => {
      socket.off('user-connected');
      socket.off('user-disconnected');
      socket.off('annotation-add');
    };
  }, [socket, addAnnotation, setOnlineUsers]);

  const setupFabricEvents = () => {
    const canvas = fabricInstanceRef.current;

    canvas.on('mouse:down', (opt) => {
      if (tool === 'select') return;

      isDrawingRef.current = true;
      const pointer = canvas.getPointer(opt.e);

      if (tool === 'pen') {
        const path = new fabric.Path(`M ${pointer.x} ${pointer.y}`, {
          stroke: color,
          strokeWidth: 3,
          fill: '',
          strokeLineCap: 'round',
          strokeLineJoin: 'round'
        });
        canvas.add(path);
        currentPathRef.current = path;
      } else if (tool === 'highlight') {
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: color,
          opacity: 0.4,
          selectable: true
        });
        canvas.add(rect);
        currentPathRef.current = rect;
      } else if (tool === 'text') {
        const text = new fabric.IText('输入文本', {
          left: pointer.x,
          top: pointer.y,
          fontFamily: 'Arial',
          fill: color,
          fontSize: 20
        });
        canvas.add(text);
        text.enterEditing();
        saveAnnotation('text', {
          left: pointer.x,
          top: pointer.y,
          text: '输入文本'
        });
      } else if (tool === 'metronome') {
        const circle = new fabric.Circle({
          left: pointer.x,
          top: pointer.y,
          radius: 15,
          fill: color,
          originX: 'center',
          originY: 'center'
        });
        canvas.add(circle);
        saveAnnotation('metronome', {
          left: pointer.x,
          top: pointer.y
        });
      }
    });

    canvas.on('mouse:move', (opt) => {
      if (!isDrawingRef.current || !currentPathRef.current || tool === 'select') return;

      const pointer = canvas.getPointer(opt.e);

      if (tool === 'pen') {
        const path = currentPathRef.current;
        const newPath = path.path + ` L ${pointer.x} ${pointer.y}`;
        path.set({ path: newPath });
        canvas.renderAll();
      } else if (tool === 'highlight') {
        const rect = currentPathRef.current;
        const width = pointer.x - rect.left;
        const height = pointer.y - rect.top;
        rect.set({ width, height });
        canvas.renderAll();
      }
    });

    canvas.on('mouse:up', () => {
      if (!isDrawingRef.current || !currentPathRef.current || tool === 'select') return;

      isDrawingRef.current = false;

      if (tool === 'pen' || tool === 'highlight') {
        const obj = currentPathRef.current;
        saveAnnotation(tool, obj.toObject());
      }

      currentPathRef.current = null;
    });

    canvas.on('object:modified', (opt) => {
      console.log('Object modified:', opt.target.toObject());
    });
  };

  const loadAnnotations = () => {
    if (!fabricInstanceRef.current) return;

    const canvas = fabricInstanceRef.current;
    canvas.clear();

    annotations
      .filter(ann => ann.page === currentPage)
      .forEach((ann) => {
        let fabricObj;

        try {
          switch (ann.type) {
            case 'highlight':
              fabricObj = new fabric.Rect({
                left: Number(ann.data?.left) || 0,
                top: Number(ann.data?.top) || 0,
                width: Number(ann.data?.width) || 0,
                height: Number(ann.data?.height) || 0,
                fill: ann.color,
                opacity: 0.4
              });
              break;
            case 'pen':
              fabricObj = new fabric.Path(String(ann.data?.path || ''), {
                stroke: ann.color,
                strokeWidth: 3,
                fill: '',
                strokeLineCap: 'round',
                strokeLineJoin: 'round'
              });
              break;
            case 'text':
              fabricObj = new fabric.IText(String(ann.data?.text || ''), {
                left: Number(ann.data?.left) || 0,
                top: Number(ann.data?.top) || 0,
                fill: ann.color,
                fontSize: 20
              });
              break;
            case 'metronome':
              fabricObj = new fabric.Circle({
                left: Number(ann.data?.left) || 0,
                top: Number(ann.data?.top) || 0,
                radius: 15,
                fill: ann.color,
                originX: 'center',
                originY: 'center'
              });
              break;
          }

          if (fabricObj) {
            canvas.add(fabricObj);
          }
        } catch (error) {
          console.error('加载批注失败:', error, ann);
        }
      });
  };

  const processMessageQueue = () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    messageQueueRef.current.sort((a, b) => a.messageId - b.messageId);

    while (messageQueueRef.current.length > 0) {
      const nextMessage = messageQueueRef.current[0];
      const expectedId = lastProcessedMessageIdRef.current + 1;

      if (nextMessage.messageId === expectedId) {
        messageQueueRef.current.shift();
        lastProcessedMessageIdRef.current = expectedId;
        renderRemoteAnnotation(nextMessage);
        addAnnotation(nextMessage);
      } else if (nextMessage.messageId < expectedId) {
        messageQueueRef.current.shift();
      } else {
        break;
      }
    }

    isProcessingQueueRef.current = false;
  };

  const enqueueMessage = (message) => {
    if (!message.messageId) {
      renderRemoteAnnotation(message);
      addAnnotation(message);
      return;
    }

    messageQueueRef.current.push(message);
    
    if (messageQueueRef.current.length > 100) {
      messageQueueRef.current = messageQueueRef.current.slice(-50);
    }
    
    processMessageQueue();
  };

  const renderRemoteAnnotation = (ann) => {
    if (!fabricInstanceRef.current) return;
    if (ann.page !== currentPage) return;

    const canvas = fabricInstanceRef.current;
    let fabricObj;

    switch (ann.type) {
      case 'highlight':
        fabricObj = new fabric.Rect({
          ...ann.data,
          fill: ann.color,
          opacity: 0.4
        });
        break;
      case 'pen':
        fabricObj = new fabric.Path(ann.data.path, {
          stroke: ann.color,
          strokeWidth: 3,
          fill: '',
          strokeLineCap: 'round',
          strokeLineJoin: 'round'
        });
        break;
      case 'text':
        fabricObj = new fabric.IText(ann.data.text || '', {
          ...ann.data,
          fill: ann.color,
          fontSize: 20
        });
        break;
      case 'metronome':
        const circle = new fabric.Circle({
          left: Number(ann.data?.x) || Number(ann.data?.left) || 0,
          top: Number(ann.data?.y) || Number(ann.data?.top) || 0,
          radius: ann.data?.isAccent ? 12 : 8,
          fill: ann.color,
          originX: 'center',
          originY: 'center'
        });
        
        const text = new fabric.Text(String(ann.data?.beatNumber || 1), {
          left: Number(ann.data?.x) || Number(ann.data?.left) || 0,
          top: (Number(ann.data?.y) || Number(ann.data?.top) || 0) + 20,
          fontSize: 12,
          fill: '#666',
          originX: 'center',
          originY: 'top'
        });
        
        fabricObj = new fabric.Group([circle, text]);
        break;
    }

    if (fabricObj) {
      canvas.add(fabricObj);
    }
  };

  const sanitizeFabricData = (type, data) => {
    if (!data) return {};

    const cleanedData = JSON.parse(JSON.stringify(data));

    switch (type) {
      case 'highlight':
        return {
          left: Number(cleanedData.left) || 0,
          top: Number(cleanedData.top) || 0,
          width: Number(cleanedData.width) || 0,
          height: Number(cleanedData.height) || 0
        };

      case 'pen':
        return {
          path: String(cleanedData.path || cleanedData.d || ''),
          left: Number(cleanedData.left) || 0,
          top: Number(cleanedData.top) || 0
        };

      case 'text':
        return {
          left: Number(cleanedData.left) || 0,
          top: Number(cleanedData.top) || 0,
          text: String(cleanedData.text || '')
        };

      case 'metronome':
        return {
          left: Number(cleanedData.left) || 0,
          top: Number(cleanedData.top) || 0
        };

      default:
        return cleanedData;
    }
  };

  const saveAnnotation = async (type, data) => {
    try {
      const sanitizedData = sanitizeFabricData(type, data);
      
      const res = await axios.post(`/api/scores/${id}/annotations`, {
        page: currentPage,
        type,
        data: sanitizedData,
        color
      });

      if (socket) {
        socket.emit('annotation-add', res.data.annotation);
      }
    } catch (error) {
      console.error('保存批注失败:', error);
    }
  };

  const saveVersion = async () => {
    try {
      await axios.post(`/api/scores/${id}/versions`, {
        description: `版本 ${versions.length + 1}`
      });
      await fetchVersions(id);
      message.success('版本保存成功');
    } catch (error) {
      message.error('保存版本失败');
    }
  };

  const restoreVersion = async (versionId) => {
    try {
      const res = await axios.post(`/api/versions/${versionId}/restore`);
      setAnnotations(res.data.annotations);
      loadAnnotations();
      message.success('版本恢复成功');
    } catch (error) {
      message.error('恢复版本失败');
    }
  };

  const clearCanvas = () => {
    if (fabricInstanceRef.current) {
      fabricInstanceRef.current.clear();
    }
  };

  const handleBeatDetectionComplete = async () => {
    await fetchAnnotations(id, currentPage);
    loadAnnotations();
    setShowBeatPanel(false);
  };

  if (loading || !currentScore) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/')}
          >
            返回
          </Button>
          <h2 className="font-display text-xl font-bold text-primary">
            {currentScore.title}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-gray-500">
            <UserOutlined />
            <span>在线: {onlineUsers.length} 人</span>
          </div>

          <Button
            icon={<SaveOutlined />}
            onClick={saveVersion}
          >
            保存版本
          </Button>

          <Button
            icon={<HistoryOutlined />}
            onClick={() => setShowVersions(true)}
          >
            历史版本
          </Button>

          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => setShowBeatPanel(true)}
          >
            AI 节拍识别
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Toolbar />

        <div className="flex-1 overflow-auto p-8 bg-gray-100">
          <div className="flex justify-center">
            <div
              className="canvas-container"
              style={{
                width: pdfCanvasRef.current?.width || 800,
                height: pdfCanvasRef.current?.height || 1000
              }}
            >
              <canvas
                ref={pdfCanvasRef}
                className="pdf-canvas"
              />
              <canvas
                ref={fabricCanvasRef}
                className="annotation-canvas"
              />
            </div>
          </div>
        </div>

        <div className="w-20 bg-white border-l p-4">
          <div className="text-center text-sm text-gray-500 mb-4">页码</div>
          <div className="flex flex-col gap-2 items-center">
            <Button
              size="small"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(currentPage - 1)}
            >
              上一页
            </Button>
            <span className="font-medium">
              {currentPage} / {currentScore.pageCount}
            </span>
            <Button
              size="small"
              disabled={currentPage >= currentScore.pageCount}
              onClick={() => setCurrentPage(currentPage + 1)}
            >
              下一页
            </Button>
          </div>

          <div className="mt-8">
            <div className="text-center text-sm text-gray-500 mb-2">缩放</div>
            <div className="flex flex-col gap-2">
              <Button
                size="small"
                onClick={() => setScale(Math.max(0.5, scale - 0.25))}
              >
                -
              </Button>
              <span className="text-center text-sm">{Math.round(scale * 100)}%</span>
              <Button
                size="small"
                onClick={() => setScale(Math.min(3, scale + 0.25))}
              >
                +
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        title="历史版本"
        open={showVersions}
        onCancel={() => setShowVersions(false)}
        footer={null}
        width={600}
      >
        <VersionPanel
          versions={versions}
          onRestore={restoreVersion}
        />
      </Modal>

      <Drawer
        title="AI 节拍识别"
        placement="right"
        onClose={() => setShowBeatPanel(false)}
        open={showBeatPanel}
        width={380}
      >
        <BeatDetectionPanel
          scoreId={id}
          currentPage={currentPage}
          onDetectComplete={handleBeatDetectionComplete}
        />
      </Drawer>
    </div>
  );
}

export default ScoreEditor;
