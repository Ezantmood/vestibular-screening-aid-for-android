import type { buildTechnicalReport } from './technicalReport';

export type TechnicalReport = ReturnType<typeof buildTechnicalReport>;
export type ValidationStage = 'review' | 'calibration' | 'pursuit' | 'saccades';

export function canExportTechnicalReport(report: TechnicalReport): boolean {
  return report.selfTest.status === 'COMPLETED' || report.physicalWorkflow.started;
}

export function restoreReviewReport(fresh: TechnicalReport, restored: TechnicalReport | null) {
  return restored ? { ...fresh, physicalWorkflow: restored.physicalWorkflow } : fresh;
}

/** One aggregate-only snapshot for this app process. No raw evidence, disk or model activation. */
export function createReportSnapshot() {
  let snapshot: TechnicalReport | null = null;
  return {
    read: () => snapshot,
    remember(report: TechnicalReport, leavingStage: ValidationStage = 'review') {
      if (!canExportTechnicalReport(report)) return;
      snapshot =
        leavingStage === 'review'
          ? report
          : {
              ...report,
              physicalWorkflow: {
                ...report.physicalWorkflow,
                interrupted: true,
                failures: [
                  ...report.physicalWorkflow.failures,
                  { stage: leavingStage, code: 'WORKFLOW_CANCELLED' as const },
                ].slice(-10),
              },
            };
    },
  };
}
export const batch3ReportSnapshot = createReportSnapshot();
