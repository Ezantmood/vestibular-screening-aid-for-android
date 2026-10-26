import { CALIBRATION_TARGETS } from './protocol';
import type { CalibrationResult, SampleBlocks, GazeRegression } from './types';
import { evaluateRegression, validRegression } from './regression';
import { CALIBRATION_POLICY, median } from './calibration';
import { calibrationFrameProgress, calibrationProgressText } from './progress';

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
      if (!finite(q.x) || !finite(q.y) || q.x < -0.25 || q.x > 1.25 || q.y < -0.25 || q.y > 1.25)
        return [];
      return [
        { target, x: q.x, y: q.y, spread: finite(q.spread) && q.spread >= 0 ? q.spread : null },
      ];
    });
    const fits = points.filter((p) => p.target.role === 'fit');
    const xs = fits.map((p) => p.x),
      ys = fits.map((p) => p.y);
    const model = record(models[eye]);
    const coefficients = (v: unknown): number[] | null =>
      Array.isArray(v) && v.length === 3 && v.every(finite) ? v : null;
    const cx = coefficients(model.coefficientsX),
      cy = coefficients(model.coefficientsY);
    const regression = model as unknown as GazeRegression;
    const currentRegression = validRegression(regression);
    const residuals = (role: 'fit' | 'validation') => {
      if (!currentRegression && (!cx || !cy)) return null;
      const rows = points
        .filter((p) => p.target.role === role)
        .map((p) => {
          const v = currentRegression
            ? evaluateRegression(regression, p.x, p.y)
            : { x: cx![0] + cx![1] * p.x + cx![2] * p.y, y: cy![0] + cy![1] * p.x + cy![2] * p.y };
          return { x: v.x - p.target.x, y: v.y - p.target.y };
        });
      if (!rows.length || rows.some((p) => !finite(p.x) || !finite(p.y))) return null;
      const x = Math.sqrt(rows.reduce((s, p) => s + p.x ** 2, 0) / rows.length);
      const y = Math.sqrt(rows.reduce((s, p) => s + p.y ** 2, 0) / rows.length);
      return finite(x) && finite(y) ? { x, y } : null;
    };
    const firstCenter = points.find((p) => p.target.id === 'fit-1-1');
    const repeatCenter = points.find((p) => p.target.id === 'check-center');
    const medianSpread = median(fits.flatMap((p) => (p.spread !== null ? [p.spread] : [])));
    return {
      eye,
      fitTargetsWithFeatures: fits.length,
      validationTargetsWithFeatures: points.length - fits.length,
      featureSpanX: fits.length > 1 ? Math.max(...xs) - Math.min(...xs) : null,
      featureSpanY: fits.length > 1 ? Math.max(...ys) - Math.min(...ys) : null,
      medianFitSpread: finite(medianSpread) ? medianSpread : null,
      featureSpanOverSpread: {
        x: medianSpread > 0 ? (Math.max(...xs) - Math.min(...xs)) / medianSpread : null,
        y: medianSpread > 0 ? (Math.max(...ys) - Math.min(...ys)) / medianSpread : null,
      },
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
  const messages = [calibrationProgressText(result)];
  for (const f of calibrationFrameProgress(result)) {
    const label = f.eye === 'left' ? 'Mắt trái trong ảnh' : 'Mắt phải trong ảnh';
    const model = result.models[f.eye];
    if (model)
      messages.push(
        `${label}: sai số kiểm chứng chéo ${Number.isFinite(model.fitCvRmse) ? model.fitCvRmse.toFixed(3) : 'chưa đo'}; RMS frame kiểm chứng ${Number.isFinite(model.validationFrameRmse) ? model.validationFrameRmse.toFixed(3) : 'chưa đo'}.`,
      );
    messages.push(
      f.withinTolerancePercent === null
        ? `${label}: chưa có số đo sai số từng frame kiểm chứng.`
        : `${label}: ${f.withinTolerancePercent.toFixed(1)}% frame kiểm chứng đã giữ nằm trong sai số ≤${f.tolerance} vùng chấm (${f.withinTolerance}/${f.accepted}); giữ ${f.acceptedCoveragePercent!.toFixed(1)}% mẫu; có số đo ${f.measuredTargets}/${f.totalTargets} điểm. Đây là độ khớp với chấm hướng dẫn, chưa phải độ chính xác lâm sàng.`,
    );
    if (f.rmse !== null && f.rmse > CALIBRATION_POLICY.maxValidationRmse)
      messages.push(
        `${label}: sai số từng frame RMSE ${f.rmse.toFixed(3)} vượt mức tham chiếu ${CALIBRATION_POLICY.maxValidationRmse}. Trung vị đạt không xác nhận độ chính xác từng frame; xem ROI và độ rung trước khi dùng số đo.`,
      );
  }
  if (result.verdict === 'VALID') return [...messages, 'Calibration đạt các ngưỡng hiện tại.'];
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
    const unstable = rows.filter((q) => q.reasons.includes('UNSTABLE_FIXATION'));
    if (unstable.length)
      messages.push(
        `${label}: ${unstable.length} điểm có độ phân tán vượt 0,04 hoặc không có mẫu. Giữ mắt ở chấm suốt lần ghi; kiểm tra ánh sáng và ảnh đồng tử trước khi thử lại.`,
      );
    if (result.reasons.some((r) => r.startsWith(`HEAD_OR_ROI_MOVED:${eye}`)))
      messages.push(
        `${label}: khung detector đổi quá 20% kích thước hoặc 0,3 độ rộng khung. Có thể do chuyển động hoặc nhận diện sai; xem ảnh ROI trước khi kết luận.`,
      );
    if (result.reasons.includes(`ORIENTATION_CHANGED:${eye}`))
      messages.push(
        `${label}: hướng xử lý ảnh của detector không nhất quán. Chưa thể kết luận điện thoại đã xoay; kiểm tra metadata hướng ảnh và ROI.`,
      );
    if (result.reasons.includes(`UNSAFE_MAPPING:${eye}`))
      messages.push(
        `${label}: model bị suy biến hoặc gập trong vùng đặc trưng đã ghi. Không dùng ánh xạ này; kiểm tra điểm nhìn, khung mặt và ROI rồi hiệu chỉnh lại.`,
      );
    if (weak > 0)
      messages.push(
        `${label}: mỗi điểm cần ≥30 mẫu, ≥60% coverage và ≥250 ms PTS. Nếu confidence thấp, tăng ánh sáng đều, tránh phản chiếu; nếu mất khung mặt, căn lại đủ cả hai mắt. Xem số liệu detector/tracking trong báo cáo.`,
      );
    const model = result.models[eye];
    const worst = rows
      .filter((q) => q.predictionError && finite(q.predictionError.distance))
      .sort((a, b) => b.predictionError!.distance - a.predictionError!.distance)
      .slice(0, 3);
    if (worst.length)
      messages.push(
        `${label}: điểm lệch nhiều nhất: ${worst.map((q) => `${q.targetId} = ${q.predictionError!.distance.toFixed(3)}`).join('; ')}. Mở ảnh ROI đúng điểm để kiểm tra dấu đồng tử.`,
      );
    if (result.reasons.includes(`POOR_FIT_CV:${eye}`))
      messages.push(
        `${label}: chưa dự đoán được các điểm fit bị giữ lại trong kiểm chứng chéo. Kiểm tra tín hiệu theo từng chấm, độ rung và mốc khung mặt.`,
      );
    if (result.reasons.some((r) => r.startsWith(`NOISY_VALIDATION:${eye}:`)))
      messages.push(
        `${label}: trung vị không đủ; từng frame kiểm chứng vượt RMS 0,08 hoặc p95 0,15. Kiểm tra độ ổn định và vị trí đồng tử trong ảnh ROI.`,
      );
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
      messages.push(
        `${label}: đặc trưng hai chiều quá ít biến thiên hoặc tương quan gần thẳng hàng. Kiểm tra ROI/đồng tử, nhìn đủ các chấm và giữ đầu yên; chưa có bằng chứng để chấp nhận model.`,
      );
  }
  const codes = [...new Set(result.reasons.map((r) => r.split(':')[0]))];
  if (codes.some((r) => ['INVALID_PTS', 'INVALID_PTS_SPAN'].includes(r)))
    messages.push(
      'Dòng thời gian frame không hợp lệ. Ghi lại và xuất báo cáo PTS; không dùng FPS danh định để thay thế.',
    );
  if (codes.some((r) => ['TARGET_NOT_HELD', 'INVALID_HOLD_CLOCK'].includes(r)))
    messages.push(
      'Không xác nhận được chấm đứng yên đủ thời gian: xem RTT và biên thời gian trong báo cáo. Giữ ứng dụng ở tiền cảnh, ghi lại.',
    );
  if (
    codes.some((r) =>
      [
        'INVALID_CONTEXT',
        'INVALID_SEQUENCE_ORDER',
        'INCOMPLETE_SEQUENCE',
        'INVALID_TARGET',
      ].includes(r),
    )
  )
    messages.push(
      'Ngữ cảnh/vùng hiển thị hoặc chuỗi ghi không hợp lệ. Cập nhật APK, mở lại màn hình và ghi đủ chuỗi.',
    );
  if (codes.some((r) => ['POOR_FIT', 'POOR_VALIDATION'].includes(r)))
    messages.push(
      'Sai số ánh xạ vượt ngưỡng: xem lỗi từng target, feature span và tương quan. Kiểm tra ảnh để loại false lock trước khi đổi thuật toán; confidence cao không chứng minh đúng đồng tử.',
    );
  messages.push(`Mã kiểm tra: ${codes.join(', ')}.`);
  messages.push(
    'Đặc trưng là vị trí đồng tử trên khung mặt. Ngưỡng sai số 0,08 là ngưỡng kỹ thuật, không phải chẩn đoán. Khi chưa đạt, ánh xạ không được dùng để chấm vị trí trên màn hình; bài đo phòng khám vẫn ghi hình.',
  );
  return messages;
}

export function calibrationCaptureFailureHint(code: string): string {
  switch (code) {
    case 'DECODE_FAILED':
      return 'Không giải mã đủ video. Ghi lại; nếu lặp lại, xuất báo cáo decode.';
    case 'FRAME_COUNT_MISMATCH':
      return 'Số frame mã hóa/giải mã không khớp. Video này không thể dùng để hiệu chỉnh; ghi lại và kiểm tra decoder.';
    case 'INVALID_PTS':
      return 'PTS thiếu, trùng hoặc không tăng. Không được thay bằng thời gian suy ra từ FPS; ghi lại và kiểm tra báo cáo.';
    case 'CAMERA_PREPARATION_FAILED':
      return 'Kiểm tra quyền camera và cài APK hiện tại; Fast Refresh không cập nhật native.';
    default:
      return 'Kiểm tra thông báo gốc và ghi lại. Nếu lặp lại, xuất báo cáo kỹ thuật; calibration chưa được chấp nhận.';
  }
}
