import { useEffect, useRef, useState, useCallback } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as bodyPix from '@tensorflow-models/body-pix';
import { BackgroundOption } from '../types';

type SegmentationMode = 'bodypix' | 'chromakey' | 'disabled';
type ProcessingBackend = 'webgl' | 'wasm' | 'cpu';

interface ChromaKeyConfig {
  color: string;
  similarity: number;
  smoothness: number;
  spillReduction: number;
}

interface PerformanceMetrics {
  fps: number;
  avgProcessingTime: number;
  backend: ProcessingBackend;
}

const DEFAULT_CHROMA_KEY_CONFIG: ChromaKeyConfig = {
  color: '#00FF00',
  similarity: 0.4,
  smoothness: 0.1,
  spillReduction: 0.2
};

export const useBackgroundSeg = () => {
  const netRef = useRef<bodyPix.BodyPix | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode, setMode] = useState<SegmentationMode>('bodypix');
  const [backend, setBackend] = useState<ProcessingBackend>('webgl');
  const [chromaKeyConfig, setChromaKeyConfig] = useState<ChromaKeyConfig>(DEFAULT_CHROMA_KEY_CONFIG);
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 0,
    avgProcessingTime: 0,
    backend: 'webgl'
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const frameCountRef = useRef(0);
  const processingTimesRef = useRef<number[]>([]);
  const lastMetricUpdateRef = useRef(Date.now());
  const targetFPSRef = useRef(30);
  const frameSkipRef = useRef(0);
  const skipCounterRef = useRef(0);

  const testWebGLPerformance = useCallback(async (): Promise<boolean> => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!gl) {
        console.warn('[BackgroundSeg] WebGL not supported');
        return false;
      }

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
      console.log('[BackgroundSeg] GPU Renderer:', renderer);

      const startTime = performance.now();
      await tf.setBackend('webgl');
      await tf.ready();
      
      const testTensor = tf.randomNormal([100, 100, 3]);
      const result = testTensor.matMul(testTensor.transpose());
      await result.data();
      
      testTensor.dispose();
      result.dispose();
      
      const duration = performance.now() - startTime;
      console.log(`[BackgroundSeg] WebGL test took ${duration.toFixed(2)}ms`);
      
      return duration < 500;
    } catch (error) {
      console.warn('[BackgroundSeg] WebGL test failed:', error);
      return false;
    }
  }, []);

  const initializeBackend = useCallback(async () => {
    console.log('[BackgroundSeg] Testing available backends...');
    
    const webglWorks = await testWebGLPerformance();
    
    if (webglWorks) {
      await tf.setBackend('webgl');
      setBackend('webgl');
      console.log('[BackgroundSeg] Using WebGL backend');
    } else {
      try {
        await tf.setBackend('wasm');
        await tf.ready();
        setBackend('wasm');
        console.log('[BackgroundSeg] WebGL failed, using WASM backend');
      } catch {
        await tf.setBackend('cpu');
        setBackend('cpu');
        console.log('[BackgroundSeg] WASM failed, using CPU backend');
      }
    }
    
    await tf.ready();
  }, [testWebGLPerformance]);

  const loadModel = useCallback(async () => {
    try {
      await initializeBackend();
      
      const net = await bodyPix.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.50,
        quantBytes: 1
      });
      
      netRef.current = net;
      setModelLoaded(true);
      console.log('[BackgroundSeg] BodyPix model loaded successfully');
    } catch (error) {
      console.error('[BackgroundSeg] Failed to load BodyPix model:', error);
      
      if (backend !== 'cpu') {
        console.log('[BackgroundSeg] Trying to downgrade to CPU backend...');
        await tf.setBackend('cpu');
        setBackend('cpu');
        await tf.ready();
        
        try {
          const net = await bodyPix.load({
            architecture: 'MobileNetV1',
            outputStride: 16,
            multiplier: 0.50,
            quantBytes: 1
          });
          netRef.current = net;
          setModelLoaded(true);
          console.log('[BackgroundSeg] BodyPix model loaded on CPU backend');
        } catch (cpuError) {
          console.error('[BackgroundSeg] CPU fallback also failed:', cpuError);
        }
      }
    }
  }, [initializeBackend, backend]);

  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  const rgbToHsl = (r: number, g: number, b: number) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h, s, l };
  };

  const applyChromaKey = useCallback((
    videoData: Uint8ClampedArray,
    width: number,
    height: number,
    config: ChromaKeyConfig
  ): ImageData => {
    const result = new ImageData(width, height);
    const resultData = result.data;
    const keyColor = hexToRgb(config.color);
    
    if (!keyColor) return new ImageData(width, height);
    
    const keyHsl = rgbToHsl(keyColor.r, keyColor.g, keyColor.b);
    const { similarity, smoothness, spillReduction } = config;

    for (let i = 0; i < videoData.length; i += 4) {
      const r = videoData[i];
      const g = videoData[i + 1];
      const b = videoData[i + 2];
      
      const pixelHsl = rgbToHsl(r, g, b);
      const hueDiff = Math.abs(pixelHsl.h - keyHsl.h);
      const normalizedHueDiff = Math.min(hueDiff, 1 - hueDiff) * 2;
      
      const similarityScore = 1 - normalizedHueDiff * pixelHsl.s;
      const alpha = similarityScore > similarity 
        ? 0 
        : Math.max(0, Math.min(1, (similarity - similarityScore) / smoothness));
      
      if (alpha > 0 && spillReduction > 0) {
        const spillAmount = similarityScore * spillReduction;
        resultData[i] = Math.max(0, r - spillAmount * keyColor.r);
        resultData[i + 1] = Math.max(0, g - spillAmount * keyColor.g);
        resultData[i + 2] = Math.max(0, b - spillAmount * keyColor.b);
      } else {
        resultData[i] = r;
        resultData[i + 1] = g;
        resultData[i + 2] = b;
      }
      
      resultData[i + 3] = Math.round(alpha * 255);
    }

    return result;
  }, []);

  const createBackgroundCanvas = useCallback((
    background: BackgroundOption,
    width: number,
    height: number
  ): HTMLCanvasElement | null => {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = width;
    bgCanvas.height = height;
    const ctx = bgCanvas.getContext('2d');
    if (!ctx) return null;

    switch (background.type) {
      case 'blur':
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);
        break;
      
      case 'color':
        ctx.fillStyle = background.value;
        ctx.fillRect(0, 0, width, height);
        break;
      
      case 'image':
        if (backgroundImageRef.current) {
          ctx.drawImage(backgroundImageRef.current, 0, 0, width, height);
        } else {
          const gradient = ctx.createLinearGradient(0, 0, width, height);
          gradient.addColorStop(0, '#667eea');
          gradient.addColorStop(1, '#764ba2');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, width, height);
        }
        break;
    }

    return bgCanvas;
  }, []);

  const downscaleFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    videoElement: HTMLVideoElement,
    scale: number
  ): { data: Uint8ClampedArray; width: number; height: number } => {
    const width = Math.floor(videoElement.videoWidth * scale);
    const height = Math.floor(videoElement.videoHeight * scale);
    
    if (!tempCanvasRef.current) {
      tempCanvasRef.current = document.createElement('canvas');
    }
    
    tempCanvasRef.current.width = width;
    tempCanvasRef.current.height = height;
    const tempCtx = tempCanvasRef.current.getContext('2d');
    
    if (!tempCtx) {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    
    tempCtx.drawImage(videoElement, 0, 0, width, height);
    const imageData = tempCtx.getImageData(0, 0, width, height);
    
    return { data: imageData.data, width, height };
  }, []);

  const segmentFrame = useCallback(async (
    videoElement: HTMLVideoElement,
    background: BackgroundOption
  ): Promise<HTMLCanvasElement | null> => {
    if (!videoElement.videoWidth) return null;

    const startTime = performance.now();
    const { width, height } = videoElement;
    
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    
    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const bgCanvas = createBackgroundCanvas(background, width, height);
    if (!bgCanvas) return null;

    let personImageData: ImageData | null = null;

    if (mode === 'chromakey') {
      const scale = 0.5;
      const { data, width: smallWidth, height: smallHeight } = downscaleFrame(ctx, videoElement, scale);
      const smallMask = applyChromaKey(data, smallWidth, smallHeight, chromaKeyConfig);
      
      tempCanvasRef.current!.width = smallWidth;
      tempCanvasRef.current!.height = smallHeight;
      const smallCtx = tempCanvasRef.current!.getContext('2d');
      if (smallCtx) {
        smallCtx.putImageData(smallMask, 0, 0);
        ctx.drawImage(tempCanvasRef.current!, 0, 0, width, height);
        personImageData = ctx.getImageData(0, 0, width, height);
      }
    } else if (mode === 'bodypix' && netRef.current) {
      const segmentation = await netRef.current.segmentPerson(videoElement, {
        flipHorizontal: false,
        internalResolution: 'low',
        segmentationThreshold: 0.6
      });

      personImageData = ctx.createImageData(width, height);
      const personData = personImageData.data;
      
      ctx.drawImage(videoElement, 0, 0, width, height);
      const videoImageData = ctx.getImageData(0, 0, width, height);
      const videoData = videoImageData.data;

      for (let i = 0; i < segmentation.data.length; i++) {
        const isPerson = segmentation.data[i] > 0;
        const pixelIndex = i * 4;
        
        if (isPerson) {
          personData[pixelIndex] = videoData[pixelIndex];
          personData[pixelIndex + 1] = videoData[pixelIndex + 1];
          personData[pixelIndex + 2] = videoData[pixelIndex + 2];
          personData[pixelIndex + 3] = 255;
        } else {
          personData[pixelIndex + 3] = 0;
        }
      }
    }

    if (personImageData) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bgCanvas, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.putImageData(personImageData, 0, 0);
    } else {
      ctx.drawImage(videoElement, 0, 0, width, height);
    }

    const processingTime = performance.now() - startTime;
    processingTimesRef.current.push(processingTime);
    
    if (processingTimesRef.current.length > 30) {
      processingTimesRef.current.shift();
    }

    return canvas;
  }, [createBackgroundCanvas, mode, chromaKeyConfig, applyChromaKey, downscaleFrame]);

  const startSegmentation = useCallback((
    videoElement: HTMLVideoElement,
    background: BackgroundOption,
    onFrame: (canvas: HTMLCanvasElement) => void
  ) => {
    if (mode !== 'disabled' && mode !== 'chromakey' && !modelLoaded) {
      console.warn('[BackgroundSeg] Model not loaded yet');
      return;
    }

    setIsProcessing(true);
    frameCountRef.current = 0;
    processingTimesRef.current = [];
    lastMetricUpdateRef.current = Date.now();

    const processFrame = async () => {
      if (mode !== 'disabled' && videoElement.readyState >= 2) {
        if (skipCounterRef.current < frameSkipRef.current) {
          skipCounterRef.current++;
        } else {
          skipCounterRef.current = 0;
          const canvas = await segmentFrame(videoElement, background);
          if (canvas) {
            onFrame(canvas);
            frameCountRef.current++;
          }
        }
      }

      const now = Date.now();
      if (now - lastMetricUpdateRef.current >= 1000) {
        const avgTime = processingTimesRef.current.length > 0
          ? processingTimesRef.current.reduce((a, b) => a + b, 0) / processingTimesRef.current.length
          : 0;
        
        setMetrics({
          fps: frameCountRef.current,
          avgProcessingTime: avgTime,
          backend
        });
        
        frameCountRef.current = 0;
        lastMetricUpdateRef.current = now;

        if (avgTime > 50 && frameSkipRef.current === 0) {
          frameSkipRef.current = 1;
          console.log('[BackgroundSeg] Reducing framerate to maintain performance');
        }
      }

      animationRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();
  }, [modelLoaded, segmentFrame, mode, backend]);

  const stopSegmentation = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setIsProcessing(false);
    frameSkipRef.current = 0;
    skipCounterRef.current = 0;
  }, []);

  const setCustomBackgroundImage = useCallback((imageUrl: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      backgroundImageRef.current = img;
    };
    img.src = imageUrl;
  }, []);

  useEffect(() => {
    loadModel();
    
    return () => {
      stopSegmentation();
      netRef.current = null;
    };
  }, [loadModel, stopSegmentation]);

  return {
    modelLoaded,
    isProcessing,
    mode,
    setMode,
    backend,
    metrics,
    chromaKeyConfig,
    setChromaKeyConfig,
    startSegmentation,
    stopSegmentation,
    setCustomBackgroundImage
  };
};
