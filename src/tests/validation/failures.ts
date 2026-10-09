import { CaptureCancelled } from '../../camera/recordingPreparation';

export const VALIDATION_FAILURE_CODES = [
  'CAMERA_PREPARATION_FAILED',
  'CAPTURE_CANCELLED',
  'CAPTURE_OR_ANALYSIS_FAILED',
  'DECODE_FAILED',
  'FRAME_COUNT_MISMATCH',
  'INVALID_PTS',
  'WORKFLOW_CANCELLED',
] as const;
export type ValidationFailureCode = (typeof VALIDATION_FAILURE_CODES)[number];
export interface ValidationFailure {
  stage: 'calibration' | 'pursuit' | 'saccades';
  code: ValidationFailureCode;
}
export const DIAGNOSTIC_FAILURE_CODES = [
  'JS_SELF_CHECKS_UNAVAILABLE',
  'NATIVE_SELF_CHECKS_UNAVAILABLE',
  'SAVED_CALIBRATION_READ_FAILED',
  'SAVED_CALIBRATION_INVALID',
] as const;
export type DiagnosticFailureCode = (typeof DIAGNOSTIC_FAILURE_CODES)[number];
/** Preserve diagnostic category, never free-form exceptions or device file paths. */
export function validationFailureCode(error: unknown): ValidationFailureCode {
  if (error instanceof CaptureCancelled) return 'CAPTURE_CANCELLED';
  if (
    error instanceof Error &&
    ['DECODE_FAILED', 'FRAME_COUNT_MISMATCH', 'INVALID_PTS'].includes(error.message)
  )
    return error.message as ValidationFailureCode;
  return 'CAPTURE_OR_ANALYSIS_FAILED';
}
