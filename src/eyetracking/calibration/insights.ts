import { CALIBRATION_TARGETS } from './protocol';
import type { CalibrationResult, SampleBlocks } from './types';
import { CALIBRATION_POLICY } from './calibration';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
function correlation(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  const va = a.reduce((s, v) => s + (v - ma) ** 2, 0);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0);
  if (va < 1e-12 || vb < 1e-12) return null;
  return Math.max(
    -1,
    Math.min(1, a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / Math.sqrt(va * vb)),
  );
}

/** Fixed aggregate diagnostics only. Accept saved/untrusted evidence, never
 * export feature positions, coefficients, ROIs, identifiers or trajectories.
 * Correlation describes a signal relationship, not a new acceptance gate. */
export function calibrationInsights(value: unknown) {
  const result = record(value);
  const qualities: unknown[] =
    Array.isArray(result.targetQuality) && result.targetQuality.length <= 28
      ? result.targetQuality
      : [];
  const models = record(result.models);
  return (['left', 'right'] as const).map((eye) => {
    const points = CALIBRATION_TARGETS.flatMap((target) => {
      const matches = qualities
        .map(record)
        .filter((q) => q.eyeSide === eye && q.targetId === target.id);
      if (matches.length !== 1) return [];
      const q = matches[0];
      if (!finite(q.x) || !finite(q.y) || q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) return [];
      return [{ target, x: q.x, y: q.y }];
    });
    const fits = points.filter((p) => p.target.role === 'fit');
    const xs = fits.map((p) => p.x),
      ys = fits.map((p) => p.y);
    const model = record(models[eye]);
    const coefficients = (v: unknown): number[] | null =>
      Array.isArray(v) && v.length === 3 && v.every(finite) ? v : null;
    const cx = coefficients(model.coefficientsX),
      cy = coefficients(model.coefficientsY);
    const residuals = (role: 'fit' | 'validation') => {
      if (!cx || !cy) return null;
      const rows = points
        .filter((p) => p.target.role === role)
        .map((p) => ({
          x: cx[0] + cx[1] * p.x + cx[2] * p.y - p.target.x,
          y: cy[0] + cy[1] * p.x + cy[2] * p.y - p.target.y,
        }));
      if (!rows.length || rows.some((p) => !finite(p.x) || !finite(p.y))) return null;
      const x = Math.sqrt(rows.reduce((s, p) => s + p.x ** 2, 0) / rows.length);
      const y = Math.sqrt(rows.reduce((s, p) => s + p.y ** 2, 0) / rows.length);
      return finite(x) && finite(y) ? { x, y } : null;
    };
    const firstCenter = points.find((p) => p.target.id === 'fit-1-1');
    const repeatCenter = points.find((p) => p.target.id === 'check-center');
    return {
      eye,
      fitTargetsWithFeatures: fits.length,
      validationTargetsWithFeatures: points.length - fits.length,
      featureSpanX: fits.length > 1 ? Math.max(...xs) - Math.min(...xs) : null,
      featureSpanY: fits.length > 1 ? Math.max(...ys) - Math.min(...ys) : null,
      featureCorrelation: correlation(xs, ys),
      targetCorrelation: {
        featureXTargetX: correlation(
          xs,
          fits.map((p) => p.target.x),
        ),
        featureXTargetY: correlation(
          xs,
          fits.map((p) => p.target.y),
        ),
        featureYTargetX: correlation(
          ys,
          fits.map((p) => p.target.x),
        ),
        featureYTargetY: correlation(
          ys,
          fits.map((p) => p.target.y),
        ),
      },
      fitAxisRmse: residuals('fit'),
      validationAxisRmse: residuals('validation'),
      centerRepeatFeatureDistance:
        firstCenter && repeatCenter
          ? Math.hypot(firstCenter.x - repeatCenter.x, firstCenter.y - repeatCenter.y)
          : null,
    };
  });
}

function addBlocks(total: SampleBlocks, row: SampleBlocks | undefined) {
  if (!row) return;
  total.noPupil += row.noPupil;
  total.lowConfidence += row.lowConfidence;
  total.noFace += row.noFace;
  total.outsideFace += row.outsideFace;
  total.badTime += row.badTime;
  total.estimated += row.estimated;
  total.trimmed += row.trimmed;
}
function blockText(blocks: SampleBlocks): string {
  const parts = [
    blocks.noPupil > 0 ? `không thấy đồng tử ${blocks.noPupil}` : '',
    blocks.lowConfidence > 0 ? `độ tin cậy dưới 0,5: ${blocks.lowConfidence}` : '',
    blocks.noFace > 0 ? `không có khung mặt ${blocks.noFace}` : '',
    blocks.outsideFace > 0 ? `đồng tử ngoài khung mặt ${blocks.outsideFace}` : '',
    blocks.badTime > 0 ? `thời điểm khung hình lỗi ${blocks.badTime}` : '',
    blocks.estimated > 0 ? `thời điểm ước lượng ${blocks.estimated}` : '',
    blocks.trimmed > 0 ? `mẫu lệch bị loại ${blocks.trimmed}` : '',
  ].filter((part) => part !== '');
  return parts.length > 0
    ? `Lý do loại: ${parts.join('; ')}.`
    : 'Không có mẫu nào bị loại theo các lý do trên.';
}
/** Explain observed failures without assigning an unproven physical cause. */
export function calibrationFeedback(result: CalibrationResult): string[] {
  if (result.verdict === 'VALID') return ['Calibration đạt các ngưỡng hiện tại.'];
  const messages: string[] = [];
  for (const eye of ['left', 'right'] as const) {
    const label = eye === 'left' ? 'Mắt trái trong ảnh' : 'Mắt phải trong ảnh';
    const rows = result.targetQuality.filter((q) => q.eyeSide === eye);
    const weak = rows.filter((q) => q.reasons.includes('INSUFFICIENT_COVERAGE')).length;
    const accepted = rows.reduce((sum, row) => sum + row.accepted, 0);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const blocks: SampleBlocks = {
      noPupil: 0,
      lowConfidence: 0,
      noFace: 0,
      outsideFace: 0,
      badTime: 0,
      estimated: 0,
      trimmed: 0,
    };
    for (const row of rows) addBlocks(blocks, row.blocks);
    if (rows.length > 0)
      messages.push(
        `${label}: giữ ${accepted}/${total} mẫu; ${weak}/${CALIBRATION_TARGETS.length} điểm dưới ${CALIBRATION_POLICY.minCoverage * 100}% mẫu. ${blockText(blocks)}`,
      );
    const model = result.models[eye];
    if (
      model &&
      (model.fitRmse > CALIBRATION_POLICY.maxFitRmse ||
        model.validationRmse > CALIBRATION_POLICY.maxValidationRmse ||
        model.validationMaxError > CALIBRATION_POLICY.maxValidationError)
    )
      messages.push(
        `${label}: ánh xạ chưa đạt (fit ${model.fitRmse.toFixed(3)}, validation ${model.validationRmse.toFixed(3)}, max ${model.validationMaxError.toFixed(3)}). Coverage cao cũng chưa đủ để dùng model.`,
      );
    if (
      result.reasons.some((r) => r === `DEGENERATE_FEATURES:${eye}` || r === `SINGULAR_FIT:${eye}`)
    )
      messages.push(`${label}: đặc trưng chưa đủ để fit ánh xạ hai chiều.`);
  }
  messages.push(
    'Đặc trưng là vị trí đồng tử trên khung mặt. Ngưỡng sai số 0,08 là ngưỡng kỹ thuật, không phải chẩn đoán. Khi chưa đạt, ánh xạ không được dùng để chấm vị trí trên màn hình; bài đo phòng khám vẫn ghi hình.',
  );
  return messages;
}
