import { Text, View } from 'react-native';
import type { EyeTestResult, TestQuality } from '../../tests/metrics/types';
import { CameraDetails } from './CameraUI';

const number = (value: number | null, digits = 3) =>
  value === null ? 'N/A' : value.toFixed(digits);
const percent = (value: number | null) => (value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`);
const statusLabel = {
  GOOD_DATA: 'Dữ liệu tốt',
  POOR_DATA: 'Dữ liệu kém chất lượng',
  INVALID: 'Test không hợp lệ',
};
function Quality({ quality }: { quality: TestQuality }) {
  return (
    <>
      <Text>
        {statusLabel[quality.status]} — coverage calibration {percent(quality.coverage)} (
        {quality.usableFrames}/{quality.totalFrames})
      </Text>
      <Text>
        Thời gian có tín hiệu liên tục: {percent(quality.temporalCoverage)}; confidence:{' '}
        {number(quality.medianConfidence)}
      </Text>
      <Text>
        Gap dài nhất: {number(quality.longestGapMs, 1)} ms; khoảng PTS trung vị:{' '}
        {number(quality.medianIntervalMs, 2)} ms
      </Text>
      {quality.reasons.length > 0 && <Text selectable>Lý do: {quality.reasons.join(', ')}</Text>}
    </>
  );
}
export default function EyeTestResults({ result }: { result: EyeTestResult }) {
  return (
    <View style={{ gap: 12 }} testID="eye-test-results">
      <Text style={{ fontSize: 21, fontWeight: '700' }}>
        {result.testId === 'smooth-pursuit' ? 'Smooth Pursuit' : 'Horizontal Saccade'}:{' '}
        {statusLabel[result.status]}
      </Text>
      <Text>
        Metric kỹ thuật để kiểm tra tín hiệu; không phải chẩn đoán bệnh. L/R là phía ảnh camera.
      </Text>
      <Text>
        Vị trí: phần vùng target; vận tốc: phần vùng target/giây. Gain và accuracy là tỷ lệ.
      </Text>
      <Text>
        Đồng bộ: {result.synchronization.source}; sai số camera:{' '}
        {result.synchronization.uncertaintyMs === null
          ? 'chưa xác định'
          : `${number(result.synchronization.uncertaintyMs)} ms`}
        . Onset là React commit.
      </Text>
      {result.tracking.map((eye) => (
        <Text key={eye.eyeSide} selectable>
          Tracking đồng tử {eye.eyeSide}: {percent(eye.coverage)} ({eye.usableFrames}/
          {eye.totalFrames}); confidence {number(eye.medianConfidence)}; blink {eye.blinkSamples};
          dropout {eye.dropoutSamples}; segments {eye.segments}; velocity samples{' '}
          {eye.velocitySamples}.
        </Text>
      ))}
      {result.pursuit.map((eye) => (
        <View key={eye.eyeSide} style={{ gap: 5 }}>
          <Text style={{ fontWeight: '700' }}>Mắt {eye.eyeSide}</Text>
          <Quality quality={eye.quality} />
          <Text>
            Pursuit gain: {number(eye.pursuitGain)}; support: {number(eye.gainSupportMs, 0)} ms
          </Text>
          <Text>
            Tracking RMSE (ghép ước lượng): {number(eye.trackingRmse)}; residual vận tốc:{' '}
            {number(eye.gainFitRmsePerSecond)}
          </Text>
          <Text>
            Chuyển động nhanh ứng viên:{' '}
            {eye.quality.status === 'INVALID' ? 'N/A' : eye.rapidMovementCandidates.length};
            catch-up ứng viên: {eye.catchUpCandidateCount ?? 'N/A'}; khoảng vận tốc bị loại:{' '}
            {eye.excludedRapidIntervals}
          </Text>
          <Text>
            Catch-up là ứng viên chuyển động giảm sai lệch mục tiêu; cần kiểm tra tracking và đồng
            bộ.
          </Text>
        </View>
      ))}
      {result.saccades.map((eye) => (
        <View key={eye.eyeSide} style={{ gap: 5 }}>
          <Text style={{ fontWeight: '700' }}>Mắt {eye.eyeSide}</Text>
          <Quality quality={eye.quality} />
          <Text>
            Response hợp lệ: {eye.validResponses}/{eye.expectedResponses} (
            {percent(eye.responseValidity)})
          </Text>
          <Text>
            Latency trung vị: {number(eye.medianLatencyMs, 1)} ms; latency ước lượng:{' '}
            {number(eye.medianEstimatedLatencyMs, 1)} ms
          </Text>
          <Text>
            Peak velocity trung vị: {number(eye.medianPeakVelocityPerSecond)} vùng target/s;
            accuracy: {percent(eye.medianAccuracy)}
          </Text>
          <Text>
            Overshoot / undershoot trung vị: {number(eye.medianOvershoot)} /{' '}
            {number(eye.medianUndershoot)}
          </Text>
          <CameraDetails title={`Từng response ${eye.eyeSide}`}>
            {eye.responses.map((r) => (
              <Text selectable key={r.step}>
                #{r.step} {r.fromX.toFixed(2)} → {r.toX.toFixed(2)}: {r.status} {r.reason ?? ''}
                {'\n'}
                latency {number(r.latencyMs, 1)} / estimate {number(r.estimatedLatencyMs, 1)} ms;
                peak {number(r.peakVelocityPerSecond)} (raw {number(r.rawPeakVelocityPerSecond)});
                accuracy {percent(r.accuracy)}; over/under {number(r.overshoot)}/
                {number(r.undershoot)}
              </Text>
            ))}
          </CameraDetails>
        </View>
      ))}
    </View>
  );
}
