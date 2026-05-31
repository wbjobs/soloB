import { useRef, useState, useCallback } from 'react';

const MFCC_COEFFICIENTS = 13;
const SAMPLE_RATE = 44100;
const FFT_SIZE = 2048;
const MEL_FILTER_BANKS = 26;

export const useVoiceprint = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [features, setFeatures] = useState<number[]>([]);

  const melFilterBank = useCallback((numFilters: number, fftSize: number, sampleRate: number): number[][] => {
    const filters: number[][] = [];
    const melMax = 2595 * Math.log10(1 + sampleRate / 1400);
    const melMin = 0;
    const melSpacing = (melMax - melMin) / (numFilters + 1);

    for (let i = 0; i < numFilters; i++) {
      const filter: number[] = new Array(fftSize / 2 + 1).fill(0);
      const melLeft = melMin + i * melSpacing;
      const melCenter = melMin + (i + 1) * melSpacing;
      const melRight = melMin + (i + 2) * melSpacing;

      const freqLeft = 700 * (Math.pow(10, melLeft / 2595) - 1);
      const freqCenter = 700 * (Math.pow(10, melCenter / 2595) - 1);
      const freqRight = 700 * (Math.pow(10, melRight / 2595) - 1);

      const binLeft = Math.floor((fftSize + 1) * freqLeft / sampleRate);
      const binCenter = Math.floor((fftSize + 1) * freqCenter / sampleRate);
      const binRight = Math.floor((fftSize + 1) * freqRight / sampleRate);

      for (let j = binLeft; j <= binCenter; j++) {
        filter[j] = (j - binLeft) / (binCenter - binLeft);
      }
      for (let j = binCenter; j <= binRight; j++) {
        filter[j] = (binRight - j) / (binRight - binCenter);
      }
      filters.push(filter);
    }
    return filters;
  }, []);

  const dct = useCallback((input: number[], numCoeffs: number): number[] => {
    const output: number[] = [];
    for (let i = 0; i < numCoeffs; i++) {
      let sum = 0;
      for (let j = 0; j < input.length; j++) {
        sum += input[j] * Math.cos(Math.PI * i * (j + 0.5) / input.length);
      }
      output.push(sum * Math.sqrt(2.0 / input.length));
    }
    return output;
  }, []);

  const extractMFCC = useCallback((audioData: Float32Array): number[] => {
    const windowed = audioData.map((value, index) => {
      const hanning = 0.5 * (1 - Math.cos(2 * Math.PI * index / (audioData.length - 1)));
      return value * hanning;
    });

    const fft = new Float32Array(FFT_SIZE);
    fft.set(windowed);

    const magnitudeSpectrum: number[] = [];
    for (let i = 0; i < FFT_SIZE / 2 + 1; i++) {
      const real = fft[i * 2] || 0;
      const imag = fft[i * 2 + 1] || 0;
      magnitudeSpectrum.push(Math.sqrt(real * real + imag * imag) + 1e-10);
    }

    const powerSpectrum = magnitudeSpectrum.map(v => v * v);
    const filters = melFilterBank(MEL_FILTER_BANKS, FFT_SIZE, SAMPLE_RATE);

    const melEnergies: number[] = [];
    for (let i = 0; i < MEL_FILTER_BANKS; i++) {
      let energy = 0;
      for (let j = 0; j < powerSpectrum.length; j++) {
        energy += powerSpectrum[j] * filters[i][j];
      }
      melEnergies.push(Math.log(energy + 1e-10));
    }

    return dct(melEnergies, MFCC_COEFFICIENTS);
  }, [melFilterBank, dct]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioContextRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = FFT_SIZE;

      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      setIsRecording(true);
    } catch (error) {
      console.error('Failed to start audio recording:', error);
      throw error;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const captureFeatures = useCallback(async (durationMs: number = 3000): Promise<number[]> => {
    if (!analyserRef.current || !audioContextRef.current) {
      throw new Error('Not recording');
    }

    const allFeatures: number[][] = [];
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);

    const startTime = Date.now();
    while (Date.now() - startTime < durationMs) {
      analyserRef.current.getFloatTimeDomainData(dataArray);
      const mfcc = extractMFCC(dataArray);
      allFeatures.push(mfcc);
      await new Promise(resolve => setTimeout(resolve, 30));
    }

    const averagedFeatures: number[] = [];
    for (let i = 0; i < MFCC_COEFFICIENTS; i++) {
      let sum = 0;
      for (const frame of allFeatures) {
        sum += frame[i];
      }
      averagedFeatures.push(sum / allFeatures.length);
    }

    const norm = Math.sqrt(averagedFeatures.reduce((sum, val) => sum + val * val, 0));
    const normalizedFeatures = averagedFeatures.map(v => v / norm);

    setFeatures(normalizedFeatures);
    return normalizedFeatures;
  }, [extractMFCC]);

  const registerVoiceprint = useCallback(async (roomId: string, userId: string): Promise<boolean> => {
    const features = await captureFeatures(3000);
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/voiceprint/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId, features })
      });
      const result = await response.json();
      return result.success;
    } catch (error) {
      console.error('Failed to register voiceprint:', error);
      return false;
    }
  }, [captureFeatures]);

  const verifyVoiceprint = useCallback(async (roomId: string, userId: string): Promise<{ match: boolean; similarity: number }> => {
    const features = await captureFeatures(2000);
    
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/voiceprint/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId, features })
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to verify voiceprint:', error);
      return { match: false, similarity: 0 };
    }
  }, [captureFeatures]);

  return {
    isRecording,
    features,
    startRecording,
    stopRecording,
    captureFeatures,
    registerVoiceprint,
    verifyVoiceprint
  };
};
