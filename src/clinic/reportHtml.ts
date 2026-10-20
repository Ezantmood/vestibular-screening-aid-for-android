import type { ClinicProfile, ExamSession, Patient } from './types';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function spark(session: ExamSession): string {
  const points = session.trace[0]?.points.filter((point) => point.x !== null) ?? [];
  if (points.length < 2) return '';
  const width = 520;
  const height = 140;
  const xs = points.map((point) => point.x as number);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = Math.max(0.001, max - min);
  const lastT = points[points.length - 1]?.tMs ?? 1;
  const d = points
    .map((point, index) => {
      const x = (point.tMs / Math.max(lastT, 1)) * width;
      const y = height - (((point.x as number) - min) / span) * (height - 8) - 4;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="140"><path d="${d}" fill="none" stroke="#087E8B" stroke-width="2"/></svg>`;
}

const flagColor = { green: '#0E7C4A', yellow: '#A15C07', red: '#B42335', unscored: '#526A78' };

export function reportHtml(args: {
  profile: ClinicProfile | null;
  patient: Patient | null;
  session: ExamSession;
  disclaimer: string;
}): string {
  const { profile, patient, session } = args;
  const rows = session.rows
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)} ${escapeHtml(row.unit)}</td><td style="color:${flagColor[row.flag]}">${row.flag}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; color: #142D3D; padding: 28px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    p, td, th { font-size: 13px; line-height: 1.4; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    td, th { border-bottom: 1px solid #D8E5E9; text-align: left; padding: 6px 4px; }
    .muted { color: #526A78; }
  </style></head><body>
  <h1>${escapeHtml(profile?.workplace || 'Vestibular Screening Aid')}</h1>
  <p>${escapeHtml(profile?.name || '')} ${escapeHtml(profile?.specialty || '')}</p>
  <p><b>${escapeHtml(patient?.name || 'Anonymous')}</b> · ${escapeHtml(patient?.externalId || '')} · ${escapeHtml(patient?.birthDate || '')}</p>
  <p class="muted">${escapeHtml(session.createdAt)} · ${escapeHtml(session.testId)} · ${escapeHtml(session.deviceModel)} · ${session.durationMs ?? '—'} ms · ${session.fps ?? '—'} fps</p>
  ${spark(session)}
  <table><tr><th>Metric</th><th>Value</th><th>Flag</th></tr>${rows}</table>
  <p>${escapeHtml(session.clinicianNote)}</p>
  <p class="muted">${escapeHtml(args.disclaimer)}</p>
  </body></html>`;
}
