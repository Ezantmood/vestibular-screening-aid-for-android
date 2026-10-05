import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { FixedMode } from '../../camera/fixedModes';
import type { PreviewRecordingReport } from '../../camera/livePreview';
import {
  closePreviewCamera,
  openPreviewCamera,
  startFraming,
  startPreviewRecording,
  stopFraming,
  stopPreviewRecording,
} from '../../camera/livePreview';

type Stage = 'closed' | 'opening' | 'preview' | 'countdown' | 'recording' | 'finishing' | 'closing';
export class CaptureCancelled extends Error {}

export function usePreviewCapture() {
  const [stage, setStage] = useState<Stage>('closed');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(false);
  const cancelled = useRef(false);
  const activeMode = useRef<string | null>(null);
  const startTime = useRef(0);
  const recording = useRef(false);

  const close = useCallback(async () => {
    cancelled.current = true;
    activeMode.current = null;
    if (mounted.current) setStage('closing');
    await stopPreviewRecording();
    await stopFraming();
    await closePreviewCamera();
    activeMode.current = null;
    if (mounted.current) setStage('closed');
  }, []);

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void close();
    });
    return () => {
      mounted.current = false;
      cancelled.current = true;
      subscription.remove();
      if (activeMode.current !== null) {
        void close();
      }
    };
  }, [close]);

  useEffect(() => {
    if (stage !== 'recording') return;
    const timer = setInterval(() => setElapsed((Date.now() - startTime.current) / 1000), 250);
    return () => clearInterval(timer);
  }, [stage]);

  async function open(mode: FixedMode) {
    if (operation.current) return;
    operation.current = true;
    cancelled.current = false;
    setError(null);
    setStage('opening');
    try {
      await openPreviewCamera(mode.cameraId, mode.width, mode.height, mode.fpsMin, mode.fpsMax);
      if (cancelled.current || !mounted.current) {
        await close();
        return;
      }
      activeMode.current = mode.label;
      if (mode.lensFacing === 'FRONT') await startFraming(500);
      if (cancelled.current || !mounted.current) {
        await close();
        return;
      }
      if (mounted.current) setStage('preview');
    } catch (e) {
      await close();
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      operation.current = false;
    }
  }

  async function capture(
    mode: FixedMode,
    duration: number,
    onRecording?: () => void,
    options?: { countdownSeconds?: number },
  ): Promise<PreviewRecordingReport> {
    if (operation.current || stage !== 'preview' || activeMode.current !== mode.label) {
      throw new Error('Mở camera và căn mặt trước khi ghi hình.');
    }
    operation.current = true;
    cancelled.current = false;
    setError(null);
    try {
      setStage('countdown');
      for (let remaining = options?.countdownSeconds ?? 3; remaining > 0; remaining -= 1) {
        if (cancelled.current || !mounted.current) throw new CaptureCancelled('Đã hủy đếm ngược.');
        setCountdown(remaining);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (cancelled.current || !mounted.current) throw new CaptureCancelled('Đã hủy ghi hình.');
      setCountdown(0);
      setElapsed(0);
      startTime.current = Date.now();
      recording.current = true;
      setStage('recording');
      onRecording?.();
      const result = await startPreviewRecording(duration);
      recording.current = false;
      if (cancelled.current || !mounted.current) throw new CaptureCancelled('Đã đóng camera.');
      setStage('finishing');
      if (!result.previewActive) activeMode.current = null;
      if (result.recordingStatus !== 'SUCCESS' || !result.filePath) {
        throw new Error(result.error ?? 'Không lưu được video. Mở lại camera và thử lại.');
      }
      if (!Array.isArray(result.sensorTimestampsNs)) {
        throw new Error('Cần cài bản Android mới để dùng luồng ghi hình này.');
      }
      return { ...result, sessionState: result.sessionState };
    } finally {
      recording.current = false;
      operation.current = false;
      if (mounted.current) {
        setCountdown(0);
        if (activeMode.current !== null) setStage('preview');
        else setStage('closed');
      }
    }
  }

  async function stop() {
    if (recording.current) {
      setStage('finishing');
      await stopPreviewRecording();
    } else {
      cancelled.current = true;
    }
  }

  return { stage, error, countdown, elapsed, open, close, capture, stop };
}
export type PreviewCaptureController = ReturnType<typeof usePreviewCapture>;
