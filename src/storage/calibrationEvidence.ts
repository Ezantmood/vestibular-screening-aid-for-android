import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { readCalibrationJson } from '../camera/eyeAnalysisStorage';
import { calibrationEvidence } from '../eyetracking/calibration/evidence';

/** Opens Android's share sheet only after an explicit button press. */
export async function shareCalibrationEvidence() {
  const json = await readCalibrationJson();
  if (!json) throw new Error('Chưa có lần hiệu chỉnh đã lưu.');
  const evidence = calibrationEvidence(JSON.parse(json));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Thiết bị chưa hỗ trợ chia sẻ file.');
  const file = new File(Paths.cache, 'calibration-evidence.json');
  file.write(JSON.stringify(evidence));
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Lưu hoặc chia sẻ số đo hiệu chỉnh',
  });
}

export async function shareCalibrationImage(path: string) {
  const file = new File(path.startsWith('file://') ? path : `file://${path}`);
  if (!file.exists) throw new Error('Ảnh ROI không còn trong bộ nhớ tạm.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Thiết bị chưa hỗ trợ chia sẻ file.');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'image/jpeg',
    dialogTitle: 'Lưu hoặc chia sẻ ảnh ROI',
  });
}
