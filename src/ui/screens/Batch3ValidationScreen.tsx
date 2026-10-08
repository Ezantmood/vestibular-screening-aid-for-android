import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import CalibrationScreen from './CalibrationScreen';
import StimulusScreen from './StimulusScreen';
import { CameraButton, CameraDetails } from '../components/CameraUI';
import { runBatch3SelfChecks, type SelfCheckResult } from '../../tests/validation/selfChecks';
import {
  buildTechnicalReport,
  BATCH3_BUILD,
  parseLocalEvidence,
  type NativeCheckResult,
} from '../../tests/validation/technicalReport';
import { exportTechnicalReport, runNativePupilChecks } from '../../camera/batch3Diagnostics';
import { readCalibrationJson } from '../../camera/eyeAnalysisStorage';
import type { EyeTestResult } from '../../tests/metrics/types';

import type { ValidationFailure, ValidationFailureCode } from '../../tests/validation/failures';

type Stage = 'review' | 'calibration' | 'pursuit' | 'saccades';
export default function Batch3ValidationScreen() {
  const [stage, setStage] = useState<Stage>('review');
  const [selfChecks, setSelfChecks] = useState<SelfCheckResult[]>([]);
  const [nativeChecks, setNativeChecks] = useState<NativeCheckResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Chạy self-test trước khi kiểm thử vật lý.');
  const [evidence, setEvidence] = useState<unknown>(null);
  const [pursuit, setPursuit] = useState<EyeTestResult | null>(null);
  const [saccades, setSaccades] = useState<EyeTestResult | null>(null);
  const [failures, setFailures] = useState<ValidationFailure[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const calibrationId = useRef<string | null>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const report = useMemo(
    () =>
      buildTechnicalReport({
        selfChecks,
        nativeChecks,
        calibrationArtifact: evidence,
        pursuit,
        saccades,
        calibrationConfirmed: confirmed,
        interrupted,
        failures,
      }),
    [selfChecks, nativeChecks, evidence, pursuit, saccades, confirmed, interrupted, failures],
  );
  async function selfTest() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setSelfChecks([]);
    setNativeChecks([]);
    setMessage('Đang chạy mô phỏng và kiểm tra CV native; không mở camera.');
    try {
      const js = await runBatch3SelfChecks();
      const native = await runNativePupilChecks();
      const saved = parseLocalEvidence(await readCalibrationJson());
      if (!mounted.current) return;
      setSelfChecks(js);
      setNativeChecks(native);
      // Reading existing evidence never activates an old calibration or fabricates a workflow.
      if (calibrationId.current === null) setEvidence(saved);
      setMessage(
        js.every((c) => c.status === 'PASS') && native.every((c) => c.status === 'PASS')
          ? 'Self-test PASS. Mô phỏng chưa xác nhận chất lượng video của người dùng.'
          : 'Self-test FAIL hoặc thiếu native module. Xuất báo cáo để kiểm tra.',
      );
    } catch {
      if (mounted.current) setMessage('Không hoàn thành self-test / đọc dữ liệu cục bộ.');
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function exportReport() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    try {
      const saved = await exportTechnicalReport(JSON.stringify(report, null, 2));
      if (mounted.current)
        setMessage(
          saved
            ? 'Đã xuất JSON tổng hợp. Video và dữ liệu mắt thô không được xuất.'
            : 'Đã hủy xuất báo cáo.',
        );
    } catch {
      if (mounted.current) setMessage('Không xuất được báo cáo. Thử lại và chọn thư mục lưu.');
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function noteFailure(stage: ValidationFailure['stage'], code: ValidationFailureCode) {
    setFailures((previous) => [...previous, { stage, code }].slice(-10));
  }
  function finishEyeTest(result: EyeTestResult, next: Stage) {
    const matched =
      result.calibrationId === calibrationId.current && calibrationId.current !== null;
    if (result.testId === 'smooth-pursuit') setPursuit(result);
    else setSaccades(result);
    if (!matched || result.status === 'INVALID') {
      if (!matched) setConfirmed(false);
      setStage('review');
      setMessage('Bài mắt INVALID. Đã dừng quy trình; metric tin cậy là N/A.');
    } else {
      setStage(next);
      if (next === 'review') setMessage('Đã hoàn thành Batch 3. Xem chất lượng và xuất báo cáo.');
    }
  }
  if (stage !== 'review')
    return (
      <View style={styles.flow}>
        {stage === 'calibration' ? (
          <CalibrationScreen
            onFailure={(code) => noteFailure('calibration', code)}
            onComplete={(result, localEvidence) => {
              setEvidence(localEvidence);
              calibrationId.current = result.verdict === 'VALID' ? result.id : null;
              setConfirmed(result.verdict === 'VALID');
              setStage(result.verdict === 'VALID' ? 'pursuit' : 'review');
              if (result.verdict !== 'VALID')
                setMessage(
                  'Calibration RETRY. Pursuit/Saccade chưa chạy; không có metric tin cậy.',
                );
            }}
          />
        ) : (
          <StimulusScreen
            onFailure={(code) => noteFailure(stage === 'pursuit' ? 'pursuit' : 'saccades', code)}
            key={stage}
            fixedTestId={stage === 'pursuit' ? 'smooth-pursuit' : 'horizontal-saccades'}
            onComplete={(result) =>
              finishEyeTest(result, stage === 'pursuit' ? 'saccades' : 'review')
            }
          />
        )}
        <CameraButton
          title="Hủy quy trình và xem báo cáo"
          tone="danger"
          onPress={() => {
            noteFailure(
              stage === 'calibration'
                ? 'calibration'
                : stage === 'pursuit'
                  ? 'pursuit'
                  : 'saccades',
              'WORKFLOW_CANCELLED',
            );
            setInterrupted(true);
            setStage('review');
            setMessage('Quy trình đã hủy. Chỉ các bước đã hoàn thành có kết quả.');
          }}
        />
      </View>
    );
  const passed =
    selfChecks.length > 0 &&
    nativeChecks.length > 0 &&
    selfChecks.every((c) => c.status === 'PASS') &&
    nativeChecks.every((c) => c.status === 'PASS');
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Kiểm thử Batch 3 độc lập</Text>
      <Text>{BATCH3_BUILD}</Text>
      <Text>
        Không cần Metro, máy tính hay kết nối điện thoại. Self-test dùng dữ liệu tổng hợp có nhãn
        riêng; không lưu thành calibration thật.
      </Text>
      <CameraButton
        title="Chạy self-test tự động"
        disabled={busy}
        onPress={() => void selfTest()}
      />
      <Text accessibilityLiveRegion="polite">{message}</Text>
      <Text>
        Kiểm thử vật lý: giữ điện thoại và đầu ổn định, đủ sáng, nhìn đúng chấm. Mỗi bước chọn
        camera trước → mở preview và căn mặt → bắt đầu quay. App tự chạy 14 target calibration và
        phân tích, rồi chuyển Pursuit → Saccade nếu calibration đạt.
      </Text>
      <CameraButton
        title="Bắt đầu Calibration → Pursuit → Saccade"
        disabled={busy || !passed}
        onPress={() => {
          setFailures([]);
          calibrationId.current = null;
          setEvidence(null);
          setPursuit(null);
          setSaccades(null);
          setConfirmed(false);
          setInterrupted(false);
          setStage('calibration');
        }}
      />
      <Text>
        Calibration: {report.physicalWorkflow.calibration.verdict}. Pursuit:{' '}
        {report.physicalWorkflow.pursuit.status}. Saccade: {report.physicalWorkflow.saccades.status}
        .
      </Text>
      {report.physicalWorkflow.calibration.eyes.map((eye) => (
        <Text key={eye.eye}>
          Mắt {eye.eye === 'left' ? 'trái' : 'phải'} trong ảnh: {eye.accepted}/{eye.total} mẫu
          calibration; coverage{' '}
          {eye.coverage === null ? 'N/A' : (eye.coverage * 100).toFixed(1) + '%'}; validation RMSE{' '}
          {eye.validationRmse?.toFixed(4) ?? 'N/A'}; model{' '}
          {eye.modelPresent ? 'có candidate' : 'chưa có'}.
        </Text>
      ))}
      <Text>
        Metric tin cậy: Pursuit {report.physicalWorkflow.pursuit.reliableMetrics ? 'có' : 'N/A'};
        Saccade {report.physicalWorkflow.saccades.reliableMetrics ? 'có' : 'N/A'}. Candidate từ
        RETRY không được sử dụng.
      </Text>
      <CameraButton
        title="Xuất báo cáo kỹ thuật JSON"
        disabled={busy}
        onPress={() => void exportReport()}
      />
      <Text>
        Báo cáo chỉ gồm phiên bản, PASS/FAIL, số lượng và chất lượng tổng hợp. Không có ảnh, video,
        centroid, đường đi mắt, ID cá nhân/thiết bị, đường dẫn hay thời điểm quay.
      </Text>
      <CameraDetails title="Chi tiết báo cáo tổng hợp">
        <Text selectable>{JSON.stringify(report, null, 2)}</Text>
      </CameraDetails>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  flow: { flex: 1, paddingBottom: 24 },
  content: { padding: 16, gap: 12, paddingBottom: 160 },
  title: { fontSize: 24, fontWeight: '700' },
});
