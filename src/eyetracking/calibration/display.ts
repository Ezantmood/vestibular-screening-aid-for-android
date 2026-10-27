import { CALIBRATION_TARGETS } from './protocol';
import { calibrationUsable } from './calibration';
import { CALIBRATION_MODEL_VERSION, currentPupilMeasurement } from './types';
import { calibrationFeedback } from './insights';
import type { CalibrationResult } from './types';

export type CalibrationScreenPhase = 'ready' | 'capture' | 'analysis' | 'result';

/** The target board must stay still only while a point is being recorded. */
export function calibrationPageScrolls(phase: CalibrationScreenPhase): boolean {
  return phase !== 'capture';
}

export type SavedCalibrationView = {
  verdict: 'VALID' | 'RETRY';
  atMs: number;
  lines: string[];
  auditImages: { target: string; paths: string[] }[];
};

function asResult(value: unknown): CalibrationResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as CalibrationResult;
  if (row.schemaVersion !== 1) return null;
  if (row.verdict !== 'VALID' && row.verdict !== 'RETRY') return null;
  if (typeof row.createdAtMs !== 'number' || !Number.isFinite(row.createdAtMs)) return null;
  if (!Array.isArray(row.reasons) || !Array.isArray(row.targetQuality)) return null;
  if (typeof row.models !== 'object' || row.models === null) return null;
  return row;
}

/** Read the on-disk artifact for display. A RETRY is shown; scoring still rejects it. */
export function describeSavedCalibration(json: string): SavedCalibrationView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('result' in parsed)) return null;
  const result = asResult((parsed as { result: unknown }).result);
  if (!result) return null;
  let lines: string[] = [];
  try {
    lines = calibrationFeedback(result);
    if (
      !currentPupilMeasurement(result.context?.coordinateVersion) ||
      result.modelVersion !== CALIBRATION_MODEL_VERSION
    )
      lines.push(
        'Kết quả dùng phiên bản tọa độ/model cũ, không được kích hoạt. Cập nhật APK và hiệu chỉnh mới.',
      );
    else if (result.verdict === 'VALID' && !calibrationUsable(result, result.context, Date.now()))
      lines.push(
        'Kết quả hiện không đủ điều kiện sử dụng (hết hạn hoặc dữ liệu lưu không hợp lệ). Cần hiệu chỉnh mới.',
      );
  } catch {
    lines = [];
  }
  return {
    verdict: result.verdict,
    atMs: result.createdAtMs,
    lines,
    auditImages: savedCalibrationAuditImages(parsed),
  };
}

/** Restore only known target ROI images from the app's pupildebug cache. */
export function savedCalibrationAuditImages(value: unknown): { target: string; paths: string[] }[] {
  if (!value || typeof value !== 'object' || !('replays' in value) || !Array.isArray(value.replays))
    return [];
  const replays = value.replays;
  return CALIBRATION_TARGETS.flatMap((target) => {
    const replay: unknown = replays.find(
      (r: unknown) =>
        r !== null && typeof r === 'object' && 'condition' in r && r.condition === target.id,
    );
    if (
      !replay ||
      typeof replay !== 'object' ||
      !('auditOverlays' in replay) ||
      !Array.isArray(replay.auditOverlays)
    )
      return [];
    const paths = replay.auditOverlays
      .filter(
        (p): p is string =>
          typeof p === 'string' &&
          /^(?:file:\/\/)?\//.test(p) &&
          /\/pupildebug\/[^/]+(?:\.jpg|_raw\.png)$/.test(p),
      )
      .slice(0, 16);
    return paths.length ? [{ target: target.id, paths }] : [];
  });
}
