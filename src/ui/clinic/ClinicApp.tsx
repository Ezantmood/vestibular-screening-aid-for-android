import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../../auth/AuthProvider';
import { fill, flagLabel, readingFor, t, testInfo } from '../../clinic/copy';
import { reportHtml } from '../../clinic/reportHtml';
import {
  daysLeft,
  deletedPatients,
  ensureProfile,
  newId,
  ownedPatients,
  patientFieldError,
  primaryNumber,
  qualityRank,
  rowsFromEyeTest,
  searchPatients,
  sessionsFor,
  setRole,
  TEST_ORDER,
  visibleSessions,
  worstFlag,
} from '../../clinic/rules';
import {
  BATTERY,
  defaultSettings,
  emptyVault,
  type ClinicSettings,
  type ClinicTestId,
  type ExamSession,
  type EyeTrace,
  type MetricRow,
  type Patient,
  type Role,
  type Sex,
  type VaultData,
} from '../../clinic/types';
import { audit, discardUnreadableVault, updateVault, wipeClinicalData } from '../../clinic/vault';
import { loadCalibration } from '../../storage/calibrationStore';
import type { EyeTestResult } from '../../tests/metrics/types';
import type { MvpTestId } from '../../tests/types';
import { CameraButton, cameraColors } from '../components/CameraUI';
import CalibrationScreen from '../screens/CalibrationScreen';
import HomeScreen from '../screens/HomeScreen';
import StimulusScreen from '../screens/StimulusScreen';
import { Chip, Field, flagColor, HoldSketch, TargetSketch, TraceChart } from './bits';
import ExtendedRun, { type ExtendedDraft } from './ExtendedRun';

type Screen =
  | {
      id:
        | 'tutorial'
        | 'home'
        | 'patients'
        | 'deleted'
        | 'settings'
        | 'audit'
        | 'tools'
        | 'instructions'
        | 'calibrate'
        | 'run'
        | 'extended'
        | 'report';
    }
  | { id: 'form'; patientId: string | null }
  | { id: 'patient'; patientId: string }
  | { id: 'setup'; patientId: string | null; anonymous: boolean }
  | { id: 'compare'; patientId: string }
  | { id: 'replay'; sessionId: string };

type Draft = { patientId: string | null; anonymous: boolean; tests: ClinicTestId[]; index: number };
type Pending = {
  testId: ClinicTestId;
  quality: ExamSession['quality'];
  rows: MetricRow[];
  trace: EyeTrace[];
  fps: number | null;
  durationMs: number | null;
  npcCm: number | null;
  npcMarked: boolean;
  savedId: string | null;
};
type FormState = { name: string; birthDate: string; sex: Sex; externalId: string; notes: string };

const blankForm = (): FormState => ({
  name: '',
  birthDate: '',
  sex: 'unspecified',
  externalId: '',
  notes: '',
});

function deviceLabel(): string {
  const name = Constants.deviceName?.trim();
  return name ? name : Platform.OS;
}

function isCore(id: ClinicTestId): id is MvpTestId {
  return id === 'smooth-pursuit' || id === 'horizontal-saccades';
}

function sexLabel(lang: VaultData['settingsByUid'][string]['language'], sex: Sex): string {
  if (sex === 'female') return t(lang, 'female');
  if (sex === 'male') return t(lang, 'male');
  if (sex === 'other') return t(lang, 'other');
  return t(lang, 'unspecified');
}

function qualityText(lang: ClinicSettings['language'], quality: ExamSession['quality']): string {
  if (quality === 'GOOD_DATA') return t(lang, 'goodQuality');
  if (quality === 'POOR_DATA') return t(lang, 'poorQuality');
  if (quality === 'RECORDED') return t(lang, 'recordedQuality');
  return t(lang, 'invalidQuality');
}

function sketchKind(id: ClinicTestId): 'dot' | 'jump' | 'stripes' | 'near' {
  if (id === 'okn') return 'stripes';
  if (id === 'npc') return 'near';
  if (id === 'smooth-pursuit' || id === 'gaze-nystagmus') return 'dot';
  return 'jump';
}

export default function ClinicApp() {
  const auth = useAuth();
  const uid = auth.uid;
  const email = auth.email ?? '';
  const [vault, setVault] = useState<VaultData>(emptyVault);
  const [screen, setScreen] = useState<Screen>({ id: 'home' });
  const [booted, setBooted] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [locked, setLocked] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<FormState>(blankForm);
  const [picked, setPicked] = useState<ClinicTestId[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState('');
  const [profileDraft, setProfileDraft] = useState({ name: '', specialty: '', workplace: '' });
  const [banner, setBanner] = useState<string | null>(null);
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);

  useEffect(() => {
    if (!uid || !auth.email) return;
    let live = true;
    const accountEmail = auth.email;
    void (async () => {
      try {
        const data = await updateVault((draftVault) => {
          draftVault.profiles = ensureProfile(draftVault.profiles, uid, accountEmail);
          if (!draftVault.settingsByUid[uid]) draftVault.settingsByUid[uid] = defaultSettings();
          audit(draftVault, {
            at: new Date().toISOString(),
            uid,
            action: 'login',
            detail: accountEmail,
          });
        });
        if (!live) return;
        setVault(data);
        setNowMs(Date.now());
        setScreen(data.settingsByUid[uid]?.tutorialSeen ? { id: 'home' } : { id: 'tutorial' });
        setLocked(false);
        setBooted(true);
      } catch {
        if (!live) return;
        setLocked(true);
        setBooted(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [uid, auth.email, bootAttempt]);

  async function resetVault() {
    setResetting(true);
    try {
      await discardUnreadableVault();
      setLocked(false);
      setBooted(false);
      setBootAttempt((value) => value + 1);
    } finally {
      setResetting(false);
    }
  }

  const profile = uid ? (vault.profiles.find((item) => item.uid === uid) ?? null) : null;
  const role: Role = profile?.role ?? 'clinician';
  const settings = (uid && vault.settingsByUid[uid]) || defaultSettings();
  const lang = settings.language;
  const fullScreen = ['tools', 'run', 'extended', 'calibrate'].includes(screen.id);

  async function commit(change: (data: VaultData) => void): Promise<VaultData> {
    const data = await updateVault(change);
    setVault(data);
    return data;
  }

  async function patchSettings(partial: Partial<ClinicSettings>) {
    if (!uid) return;
    await commit((data) => {
      const current = data.settingsByUid[uid] ?? defaultSettings();
      data.settingsByUid[uid] = { ...current, ...partial };
    });
  }

  async function signOut() {
    if (!uid) return;
    try {
      if (settings.wipeOnLogout) await wipeClinicalData(uid);
      else {
        await commit((data) => {
          audit(data, { at: new Date().toISOString(), uid, action: 'logout', detail: email });
        });
      }
    } finally {
      await auth.logout();
    }
  }

  function openForm(patient: Patient | null) {
    setForm(
      patient
        ? {
            name: patient.name,
            birthDate: patient.birthDate,
            sex: patient.sex,
            externalId: patient.externalId,
            notes: patient.notes,
          }
        : blankForm(),
    );
    setBanner(null);
    setScreen({ id: 'form', patientId: patient?.id ?? null });
  }

  async function saveForm() {
    if (!uid || screen.id !== 'form') return;
    const stamp = Date.now();
    const problem = patientFieldError(form, stamp);
    if (problem) {
      setBanner(t(lang, problem === 'name' ? 'needName' : 'needBirth'));
      return;
    }
    const now = new Date(stamp).toISOString();
    const editingId = screen.patientId;
    await commit((data) => {
      if (editingId) {
        const patient = data.patients.find((item) => item.id === editingId);
        if (!patient) return;
        patient.name = form.name.trim();
        patient.birthDate = form.birthDate.trim();
        patient.sex = form.sex;
        patient.externalId = form.externalId.trim();
        patient.notes = form.notes.trim();
        patient.updatedAt = now;
        audit(data, { at: now, uid, action: 'patient-edit', detail: patient.id });
        return;
      }
      const patient: Patient = {
        id: newId(),
        ownerUid: uid,
        name: form.name.trim(),
        birthDate: form.birthDate.trim(),
        sex: form.sex,
        externalId: form.externalId.trim(),
        notes: form.notes.trim(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      data.patients.push(patient);
      audit(data, { at: now, uid, action: 'patient-create', detail: patient.id });
    });
    setScreen({ id: 'patients' });
  }

  async function deletePatient(patientId: string) {
    if (!uid) return;
    const now = new Date().toISOString();
    await commit((data) => {
      const patient = data.patients.find((item) => item.id === patientId);
      if (!patient) return;
      patient.deletedAt = now;
      patient.updatedAt = now;
      audit(data, { at: now, uid, action: 'patient-delete', detail: patientId });
    });
    setArmedDelete(false);
    setScreen({ id: 'patients' });
  }

  async function restorePatient(patientId: string) {
    if (!uid) return;
    const now = new Date().toISOString();
    await commit((data) => {
      const patient = data.patients.find((item) => item.id === patientId);
      if (!patient || patient.deletedAt === null) return;
      patient.deletedAt = null;
      patient.updatedAt = now;
      audit(data, { at: now, uid, action: 'patient-restore', detail: patientId });
    });
  }

  function openSetup(patientId: string | null, anonymous: boolean) {
    setPicked([]);
    setDraft(null);
    setPending(null);
    setBanner(null);
    setCalibrationDone(false);
    setScreen({ id: 'setup', patientId, anonymous });
  }

  function beginInstructions() {
    if (screen.id !== 'setup') return;
    if (picked.length === 0) {
      setBanner(t(lang, 'pickTest'));
      return;
    }
    setDraft({ patientId: screen.patientId, anonymous: screen.anonymous, tests: picked, index: 0 });
    setBanner(null);
    setScreen({ id: 'instructions' });
  }

  async function beginRecording() {
    const testId = draft?.tests[draft.index];
    if (!testId) return;
    const calibration = await loadCalibration();
    if (!calibrationDone && (!calibration || calibration.verdict !== 'VALID')) {
      setBanner(t(lang, 'calibrateFirst'));
      setScreen({ id: 'calibrate' });
      return;
    }
    setBanner(null);
    setScreen({ id: isCore(testId) ? 'run' : 'extended' });
  }

  function acceptResult(next: Pending) {
    setNote('');
    setPending(next);
    setBanner(null);
    setScreen({ id: 'report' });
  }

  function onEyeComplete(
    result: EyeTestResult,
    trace: EyeTrace[],
    capture: { fps: number | null; durationMs: number | null },
  ) {
    const testId = draft?.tests[draft.index];
    if (!testId) return;
    acceptResult({
      testId,
      quality: result.status,
      rows: rowsFromEyeTest(result, settings.normGroup),
      trace,
      fps: capture.fps,
      durationMs: capture.durationMs,
      npcCm: null,
      npcMarked: false,
      savedId: null,
    });
  }

  function onExtended(result: ExtendedDraft) {
    acceptResult({ ...result, savedId: null });
  }

  async function saveResult() {
    if (!uid || !draft || !pending || settings.demoMode || pending.savedId) return;
    const id = newId();
    const createdAt = new Date().toISOString();
    const session: ExamSession = {
      id,
      patientId: draft.anonymous ? null : draft.patientId,
      ownerUid: uid,
      testId: pending.testId,
      createdAt,
      quality: pending.quality,
      rows: pending.rows,
      trace: pending.trace,
      clinicianNote: note,
      deviceModel: deviceLabel(),
      durationMs: pending.durationMs,
      fps: pending.fps,
      npcCm: pending.npcCm,
    };
    await commit((data) => {
      data.sessions.push(session);
      audit(data, { at: createdAt, uid, action: 'test', detail: pending.testId });
    });
    setPending({ ...pending, savedId: id });
    setBanner(t(lang, 'saved'));
  }

  async function updateNote() {
    if (!uid || !pending?.savedId || settings.demoMode) return;
    const savedId = pending.savedId;
    await commit((data) => {
      const session = data.sessions.find((item) => item.id === savedId);
      if (session) session.clinicianNote = note;
    });
    setBanner(t(lang, 'saved'));
  }

  function buildPreview(): ExamSession | null {
    if (!uid || !draft || !pending) return null;
    if (pending.savedId) return vault.sessions.find((item) => item.id === pending.savedId) ?? null;
    return {
      id: 'preview',
      patientId: draft.anonymous ? null : draft.patientId,
      ownerUid: uid,
      testId: pending.testId,
      createdAt: new Date().toISOString(),
      quality: pending.quality,
      rows: pending.rows,
      trace: pending.trace,
      clinicianNote: note,
      deviceModel: deviceLabel(),
      durationMs: pending.durationMs,
      fps: pending.fps,
      npcCm: pending.npcCm,
    };
  }

  async function exportPdf() {
    const session = buildPreview();
    if (!session || !uid) return;
    setPdfBusy(true);
    try {
      const patient = vault.patients.find((item) => item.id === session.patientId) ?? null;
      const html = reportHtml({
        profile,
        patient,
        session: { ...session, clinicianNote: note || session.clinicianNote },
        disclaimer: `${t(lang, 'screening')} ${t(lang, 'notDiagnosis')} ${t(lang, 'normLegend')}`,
      });
      const file = await Print.printToFileAsync({ html });
      if (!settings.demoMode) {
        await commit((data) => {
          audit(data, { at: new Date().toISOString(), uid, action: 'pdf', detail: session.testId });
        });
      }
      if (!(await Sharing.isAvailableAsync())) {
        setBanner(t(lang, 'shareFailed'));
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
    } catch {
      setBanner(t(lang, 'pdfFailed'));
    } finally {
      setPdfBusy(false);
    }
  }

  function repeatTest() {
    setPending(null);
    setNote('');
    setBanner(null);
    setScreen({ id: 'instructions' });
  }

  function nextTest() {
    if (!draft) return;
    const next = draft.index + 1;
    setPending(null);
    setNote('');
    if (next >= draft.tests.length) {
      setScreen(
        draft.patientId && !draft.anonymous
          ? { id: 'patient', patientId: draft.patientId }
          : { id: 'home' },
      );
      return;
    }
    setDraft({ ...draft, index: next });
    setScreen({ id: 'instructions' });
  }

  const owned = ownedPatients(vault.patients, role, uid ?? '');
  const patients = searchPatients(owned, query, nowMs);
  const removed = deletedPatients(owned, nowMs);
  const sessions = visibleSessions(vault.sessions, role, uid ?? '');
  const currentTest = draft?.tests[draft.index] ?? null;
  const info = currentTest ? testInfo(lang, currentTest) : null;

  async function saveProfile() {
    if (!uid) return;
    await commit((data) => {
      const current = data.profiles.find((item) => item.uid === uid);
      if (!current) return;
      current.name = profileDraft.name.trim();
      current.specialty = profileDraft.specialty.trim();
      current.workplace = profileDraft.workplace.trim();
    });
    setBanner(t(lang, 'saved'));
  }

  async function changeRole(profileUid: string, nextRole: Role) {
    const changed = setRole(vault.profiles, profileUid, nextRole);
    if (changed.find((item) => item.uid === profileUid)?.role !== nextRole) {
      setBanner(t(lang, 'lastAdmin'));
      return;
    }
    await commit((data) => {
      data.profiles = setRole(data.profiles, profileUid, nextRole);
    });
  }

  let body = null;
  if (screen.id === 'tutorial') {
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'tutorial')}</Text>
        <HoldSketch />
        <Text style={styles.body}>{t(lang, 'tutorialHold')}</Text>
        <Text style={styles.body}>{t(lang, 'tutorialDistance')}</Text>
        <Text style={styles.body}>{t(lang, 'tutorialLight')}</Text>
        <Text style={styles.body}>{t(lang, 'tutorialStill')}</Text>
        <Text style={styles.body}>{t(lang, 'limit120')}</Text>
        <Text style={styles.body}>{t(lang, 'offlineNote')}</Text>
        <CameraButton
          title={t(lang, 'done')}
          onPress={() =>
            void patchSettings({ tutorialSeen: true }).then(() => setScreen({ id: 'home' }))
          }
        />
      </View>
    );
  } else if (screen.id === 'home') {
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'home')}</Text>
        <Text style={styles.body}>{t(lang, 'screening')}</Text>
        {settings.demoMode && <Text style={styles.warn}>{t(lang, 'demoOn')}</Text>}
        <Text style={styles.body}>{t(lang, 'nothingUploaded')}</Text>
        <CameraButton title={t(lang, 'patients')} onPress={() => setScreen({ id: 'patients' })} />
        <CameraButton
          title={t(lang, 'anonymous')}
          tone="secondary"
          onPress={() => openSetup(null, true)}
        />
        <CameraButton
          title={t(lang, 'tutorial')}
          tone="secondary"
          onPress={() => setScreen({ id: 'tutorial' })}
        />
        <CameraButton
          title={t(lang, 'settings')}
          tone="secondary"
          onPress={() => {
            setProfileDraft({
              name: profile?.name ?? '',
              specialty: profile?.specialty ?? '',
              workplace: profile?.workplace ?? '',
            });
            setScreen({ id: 'settings' });
          }}
        />
        <CameraButton
          title={t(lang, 'tools')}
          tone="secondary"
          onPress={() => setScreen({ id: 'tools' })}
        />
        <Text style={styles.section}>{t(lang, 'anonymousRuns')}</Text>
        {sessionsFor(sessions, null).length === 0 && (
          <Text style={styles.body}>{t(lang, 'emptyHistory')}</Text>
        )}
        {sessionsFor(sessions, null).map((session) => (
          <SessionLine
            key={session.id}
            session={session}
            lang={lang}
            onPress={() => setScreen({ id: 'replay', sessionId: session.id })}
          />
        ))}
      </View>
    );
  } else if (screen.id === 'patients') {
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'patients')}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t(lang, 'search')}
          placeholderTextColor={cameraColors.muted}
          accessibilityLabel={t(lang, 'search')}
          testID="patient-search"
          style={styles.input}
        />
        <CameraButton title={t(lang, 'newPatient')} onPress={() => openForm(null)} />
        {patients.length === 0 && <Text style={styles.body}>{t(lang, 'noPatient')}</Text>}
        {patients.map((patient) => (
          <Pressable
            key={patient.id}
            accessibilityRole="button"
            onPress={() => {
              setArmedDelete(false);
              setScreen({ id: 'patient', patientId: patient.id });
            }}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>{patient.name}</Text>
            <Text style={styles.body}>
              {patient.externalId || '—'} · {patient.birthDate} · {sexLabel(lang, patient.sex)}
            </Text>
          </Pressable>
        ))}
        <CameraButton
          title={t(lang, 'openDeleted')}
          tone="secondary"
          onPress={() => {
            setNowMs(Date.now());
            setScreen({ id: 'deleted' });
          }}
        />
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'home' })}
        />
      </View>
    );
  } else if (screen.id === 'form') {
    const editing = screen.patientId;
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{editing ? t(lang, 'edit') : t(lang, 'newPatient')}</Text>
        <Field
          label={t(lang, 'patientName')}
          value={form.name}
          onChangeText={(name) => setForm({ ...form, name })}
          testID="patient-name"
        />
        <Field
          label={t(lang, 'birth')}
          value={form.birthDate}
          placeholder="YYYY-MM-DD"
          onChangeText={(birthDate) => setForm({ ...form, birthDate })}
          testID="patient-birth"
        />
        <Text style={styles.section}>{t(lang, 'sex')}</Text>
        <View style={styles.row}>
          {(['female', 'male', 'other', 'unspecified'] as const).map((sex) => (
            <Chip
              key={sex}
              label={sexLabel(lang, sex)}
              active={form.sex === sex}
              onPress={() => setForm({ ...form, sex })}
            />
          ))}
        </View>
        <Field
          label={t(lang, 'idOptional')}
          value={form.externalId}
          onChangeText={(externalId) => setForm({ ...form, externalId })}
        />
        <Field
          label={t(lang, 'notes')}
          value={form.notes}
          multiline
          onChangeText={(notes) => setForm({ ...form, notes })}
        />
        <CameraButton
          title={t(lang, 'save')}
          onPress={() => void saveForm()}
          testID="patient-save"
        />
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'patients' })}
        />
      </View>
    );
  } else if (screen.id === 'patient') {
    const patient = patients.find((item) => item.id === screen.patientId) ?? null;
    const history = patient ? sessionsFor(sessions, patient.id) : [];
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{patient?.name ?? t(lang, 'unnamed')}</Text>
        {patient && (
          <Text style={styles.body}>
            {patient.birthDate} · {sexLabel(lang, patient.sex)} · {patient.externalId || '—'}
          </Text>
        )}
        {patient?.notes ? <Text style={styles.body}>{patient.notes}</Text> : null}
        <CameraButton
          title={t(lang, 'startExam')}
          onPress={() => patient && openSetup(patient.id, false)}
        />
        <CameraButton
          title={t(lang, 'edit')}
          tone="secondary"
          onPress={() => patient && openForm(patient)}
        />
        <CameraButton
          title={t(lang, 'compare')}
          tone="secondary"
          onPress={() => patient && setScreen({ id: 'compare', patientId: patient.id })}
        />
        <Text style={styles.section}>{t(lang, 'history')}</Text>
        {history.length === 0 && <Text style={styles.body}>{t(lang, 'emptyHistory')}</Text>}
        {history.map((session) => (
          <SessionLine
            key={session.id}
            session={session}
            lang={lang}
            onPress={() => setScreen({ id: 'replay', sessionId: session.id })}
          />
        ))}
        {!armedDelete && (
          <CameraButton
            title={t(lang, 'remove')}
            tone="danger"
            onPress={() => setArmedDelete(true)}
          />
        )}
        {armedDelete && <Text style={styles.warn}>{t(lang, 'confirmDelete')}</Text>}
        {armedDelete && patient && (
          <CameraButton
            title={t(lang, 'yesDelete')}
            tone="danger"
            onPress={() => void deletePatient(patient.id)}
          />
        )}
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'patients' })}
        />
      </View>
    );
  } else if (screen.id === 'deleted') {
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'deleted')}</Text>
        {removed.length === 0 && <Text style={styles.body}>{t(lang, 'noPatient')}</Text>}
        {removed.map((patient) => (
          <View key={patient.id} style={styles.card}>
            <Text style={styles.cardTitle}>{patient.name}</Text>
            <Text style={styles.body}>
              {fill(t(lang, 'daysLeft'), String(daysLeft(patient, nowMs)))}
            </Text>
            <CameraButton
              title={t(lang, 'restore')}
              tone="secondary"
              onPress={() => void restorePatient(patient.id)}
            />
          </View>
        ))}
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'patients' })}
        />
      </View>
    );
  } else if (screen.id === 'setup') {
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'tests')}</Text>
        <Text style={styles.body}>{t(lang, 'durationNote')}</Text>
        <Text style={styles.body}>{t(lang, 'limit120')}</Text>
        {settings.demoMode && <Text style={styles.warn}>{t(lang, 'demoOn')}</Text>}
        <CameraButton
          title={t(lang, 'battery')}
          tone={picked.length === BATTERY.length ? 'primary' : 'secondary'}
          onPress={() => setPicked([...BATTERY])}
        />
        <View style={styles.row}>
          {TEST_ORDER.map((id) => (
            <Chip
              key={id}
              label={testInfo(lang, id).title}
              active={picked.includes(id)}
              onPress={() =>
                setPicked((current) => {
                  const next = current.includes(id)
                    ? current.filter((item) => item !== id)
                    : [...current, id];
                  return TEST_ORDER.filter((item) => next.includes(item));
                })
              }
            />
          ))}
        </View>
        <CameraButton title={t(lang, 'instructions')} onPress={beginInstructions} />
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() =>
            setScreen(
              screen.patientId ? { id: 'patient', patientId: screen.patientId } : { id: 'home' },
            )
          }
        />
      </View>
    );
  } else if (screen.id === 'instructions' && info && currentTest) {
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{info.title}</Text>
        <TargetSketch kind={sketchKind(currentTest)} />
        <Text style={styles.body}>{info.steps}</Text>
        <Text style={styles.body}>{info.look}</Text>
        <Text style={styles.body}>{t(lang, 'holdStill')}</Text>
        <Text style={styles.body}>{t(lang, 'lightText')}</Text>
        <Text style={styles.body}>{t(lang, 'headText')}</Text>
        <Text style={styles.body}>{t(lang, 'qualityFraming')}</Text>
        <Text style={styles.body}>{t(lang, 'pupilLater')}</Text>
        <Text style={styles.body}>{t(lang, 'limitUnits')}</Text>
        {currentTest === 'npc' && <Text style={styles.body}>{t(lang, 'limitNpc')}</Text>}
        {(currentTest === 'vertical-saccades' || currentTest === 'anti-saccade') && (
          <Text style={styles.body}>{t(lang, 'unaligned')}</Text>
        )}
        <Text style={styles.body}>{t(lang, 'calibrateFirst')}</Text>
        <CameraButton title={t(lang, 'startRecording')} onPress={() => void beginRecording()} />
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() =>
            setScreen({
              id: 'setup',
              patientId: draft?.patientId ?? null,
              anonymous: draft?.anonymous ?? false,
            })
          }
        />
      </View>
    );
  } else if (screen.id === 'calibrate') {
    body = (
      <View style={styles.flex}>
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'instructions' })}
        />
        <CalibrationScreen
          onComplete={(result) => {
            const testId = draft?.tests[draft.index];
            if (!testId) return;
            setCalibrationDone(true);
            setBanner(result.verdict === 'VALID' ? null : t(lang, 'calRetry'));
            setScreen({ id: isCore(testId) ? 'run' : 'extended' });
          }}
        />
      </View>
    );
  } else if (screen.id === 'run' && currentTest && isCore(currentTest)) {
    body = (
      <View style={styles.flex}>
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'instructions' })}
        />
        <StimulusScreen
          fixedTestId={currentTest}
          clinicMode
          discardRecording
          onComplete={onEyeComplete}
        />
      </View>
    );
  } else if (screen.id === 'extended' && currentTest) {
    body = (
      <ExtendedRun
        testId={currentTest}
        lang={lang}
        group={settings.normGroup}
        onDone={onExtended}
        onBack={() => setScreen({ id: 'instructions' })}
      />
    );
  } else if (screen.id === 'report' && pending) {
    const flag = worstFlag(pending.rows.map((row) => row.flag));
    const patient = vault.patients.find((item) => item.id === draft?.patientId) ?? null;
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'report')}</Text>
        <Text style={styles.body}>{testInfo(lang, pending.testId).title}</Text>
        <Text style={styles.body}>
          {draft?.anonymous || !patient ? t(lang, 'anonymousPatient') : patient.name}
        </Text>
        <Text style={[styles.body, { color: flagColor[qualityRank(pending)] }]}>
          {t(lang, 'qualityTitle')}: {qualityText(lang, pending.quality)}
        </Text>
        {pending.quality !== 'GOOD_DATA' && (
          <Text style={styles.warn}>{t(lang, 'poorQuality')}</Text>
        )}
        <Text style={styles.body}>
          {pending.durationMs ?? '—'} ms · {pending.fps ?? '—'} {t(lang, 'fpsMode')} ·{' '}
          {deviceLabel()}
        </Text>
        <Text style={styles.body}>{t(lang, 'durationNote')}</Text>
        {pending.rows.map((row) => (
          <View key={row.id} style={styles.card}>
            <Text style={styles.cardTitle}>{row.label}</Text>
            <Text style={{ color: flagColor[row.flag] }}>
              {row.value} {row.unit} · {flagLabel(lang, row.flag)}
            </Text>
          </View>
        ))}
        <Text style={styles.section}>{t(lang, 'suggested')}</Text>
        <Text style={styles.body}>{readingFor(lang, flag)}</Text>
        <Text style={styles.body}>{t(lang, 'normLegend')}</Text>
        <Text style={styles.body}>{t(lang, 'traceCaption')}</Text>
        <Text style={styles.body}>{t(lang, 'videoDeleted')}</Text>
        {(pending.testId === 'vertical-saccades' || pending.testId === 'anti-saccade') && (
          <Text style={styles.body}>{t(lang, 'unaligned')}</Text>
        )}
        {pending.testId === 'npc' && (
          <Text style={styles.body}>
            {pending.npcMarked ? t(lang, 'marked') : t(lang, 'pupilGap')}
          </Text>
        )}
        <TraceChart traces={pending.trace} />
        {pending.trace.every((trace) => trace.points.length < 2) && (
          <Text style={styles.body}>{t(lang, 'noTrace')}</Text>
        )}
        <Field label={t(lang, 'note')} value={note} multiline onChangeText={setNote} />
        {!settings.demoMode && !pending.savedId && (
          <CameraButton title={t(lang, 'saveResult')} onPress={() => void saveResult()} />
        )}
        {pending.savedId && !settings.demoMode && (
          <CameraButton
            title={t(lang, 'updateNote')}
            tone="secondary"
            onPress={() => void updateNote()}
          />
        )}
        {settings.demoMode && <Text style={styles.warn}>{t(lang, 'demoOn')}</Text>}
        <Text style={styles.body}>{pending.savedId ? t(lang, 'saved') : t(lang, 'notSaved')}</Text>
        <CameraButton title={t(lang, 'repeat')} tone="secondary" onPress={repeatTest} />
        <CameraButton
          title={pdfBusy ? t(lang, 'makingPdf') : t(lang, 'pdf')}
          tone="secondary"
          disabled={pdfBusy}
          onPress={() => void exportPdf()}
        />
        <CameraButton
          title={t(lang, 'share')}
          tone="secondary"
          disabled={pdfBusy}
          onPress={() => void exportPdf()}
        />
        <CameraButton
          title={
            draft && draft.index + 1 < draft.tests.length ? t(lang, 'nextTest') : t(lang, 'done')
          }
          onPress={nextTest}
        />
      </View>
    );
  } else if (screen.id === 'compare') {
    const history = sessionsFor(sessions, screen.patientId);
    const ids = TEST_ORDER.filter((id) => history.some((session) => session.testId === id));
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'compare')}</Text>
        <Text style={styles.body}>{t(lang, 'notDiagnosis')}</Text>
        {ids.length === 0 && <Text style={styles.body}>{t(lang, 'noCompare')}</Text>}
        {ids.map((id) => {
          const rows = history
            .filter((session) => session.testId === id)
            .slice()
            .reverse();
          return (
            <View key={id} style={styles.card}>
              <Text style={styles.cardTitle}>{testInfo(lang, id).title}</Text>
              {rows.length < 2 && <Text style={styles.body}>{t(lang, 'noCompare')}</Text>}
              {rows.map((session) => {
                const value = primaryNumber(session);
                const unit = session.rows[0]?.unit ?? '';
                const scale = unit === 'ms' ? 500 : unit === 'cm' ? 20 : 1.5;
                const width =
                  value === null ? 0 : Math.max(4, Math.min(100, (Math.abs(value) / scale) * 100));
                return (
                  <View key={session.id}>
                    <Text style={styles.body}>
                      {session.createdAt.replace('T', ' ').slice(0, 16)} · {value ?? '—'} {unit}
                    </Text>
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.meter,
                          { width: `${width}%`, backgroundColor: flagColor[qualityRank(session)] },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'patient', patientId: screen.patientId })}
        />
      </View>
    );
  } else if (screen.id === 'replay') {
    const session = sessions.find((item) => item.id === screen.sessionId) ?? null;
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'replay')}</Text>
        <Text style={styles.body}>{t(lang, 'videoDeleted')}</Text>
        <Text style={styles.body}>{t(lang, 'traceCaption')}</Text>
        {session ? (
          <TraceChart traces={session.trace} />
        ) : (
          <Text style={styles.body}>{t(lang, 'noTrace')}</Text>
        )}
        {session?.clinicianNote ? <Text style={styles.body}>{session.clinicianNote}</Text> : null}
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() =>
            setScreen(
              session?.patientId ? { id: 'patient', patientId: session.patientId } : { id: 'home' },
            )
          }
        />
      </View>
    );
  } else if (screen.id === 'settings') {
    const events = (
      role === 'admin' ? vault.audit : vault.audit.filter((event) => event.uid === uid)
    )
      .slice(-12)
      .reverse();
    body = (
      <View style={styles.stack}>
        <Text style={styles.title}>{t(lang, 'settings')}</Text>
        <Text style={styles.section}>{t(lang, 'clinicProfile')}</Text>
        <Field
          label={t(lang, 'yourName')}
          value={profileDraft.name}
          onChangeText={(name) => setProfileDraft({ ...profileDraft, name })}
        />
        <Field
          label={t(lang, 'specialty')}
          value={profileDraft.specialty}
          onChangeText={(specialty) => setProfileDraft({ ...profileDraft, specialty })}
        />
        <Field
          label={t(lang, 'workplace')}
          value={profileDraft.workplace}
          onChangeText={(workplace) => setProfileDraft({ ...profileDraft, workplace })}
        />
        <Text style={styles.body}>{t(lang, 'logoNote')}</Text>
        <CameraButton title={t(lang, 'saveProfile')} onPress={() => void saveProfile()} />
        <Text style={styles.section}>
          {t(lang, 'role')}: {role === 'admin' ? t(lang, 'admin') : t(lang, 'clinician')}
        </Text>
        {role === 'admin' &&
          vault.profiles.map((item) => (
            <View key={item.uid} style={styles.card}>
              <Text style={styles.cardTitle}>{item.email}</Text>
              <Text style={styles.body}>
                {item.role === 'admin' ? t(lang, 'admin') : t(lang, 'clinician')}
              </Text>
              {item.uid !== uid && (
                <View style={styles.row}>
                  <Chip
                    label={t(lang, 'admin')}
                    active={item.role === 'admin'}
                    onPress={() => void changeRole(item.uid, 'admin')}
                  />
                  <Chip
                    label={t(lang, 'clinician')}
                    active={item.role === 'clinician'}
                    onPress={() => void changeRole(item.uid, 'clinician')}
                  />
                </View>
              )}
            </View>
          ))}
        <Text style={styles.section}>{t(lang, 'language')}</Text>
        <View style={styles.row}>
          <Chip
            label="Tiếng Việt"
            active={lang === 'vi'}
            onPress={() => void patchSettings({ language: 'vi' })}
          />
          <Chip
            label="English"
            active={lang === 'en'}
            onPress={() => void patchSettings({ language: 'en' })}
          />
        </View>
        <Text style={styles.section}>{t(lang, 'norm')}</Text>
        <View style={styles.row}>
          <Chip
            label={t(lang, 'adult')}
            active={settings.normGroup === 'adult'}
            onPress={() => void patchSettings({ normGroup: 'adult' })}
          />
          <Chip
            label={t(lang, 'older')}
            active={settings.normGroup === 'older-adult'}
            onPress={() => void patchSettings({ normGroup: 'older-adult' })}
          />
        </View>
        <Text style={styles.body}>{t(lang, 'normLegend')}</Text>
        <RowSwitch
          label={t(lang, 'training')}
          value={settings.demoMode}
          onChange={(demoMode) => void patchSettings({ demoMode })}
        />
        <Text style={styles.body}>{t(lang, 'demoHint')}</Text>
        <RowSwitch
          label={t(lang, 'wipe')}
          value={settings.wipeOnLogout}
          onChange={(wipeOnLogout) => void patchSettings({ wipeOnLogout })}
        />
        <Text style={styles.body}>{t(lang, 'wipeHint')}</Text>
        <RowSwitch
          label="Cloud"
          value={settings.cloudBackup}
          onChange={(cloudBackup) => void patchSettings({ cloudBackup })}
        />
        <Text style={styles.body}>
          {settings.cloudBackup ? t(lang, 'cloudOn') : t(lang, 'cloudOff')}
        </Text>
        <Text style={styles.body}>{t(lang, 'offlineNote')}</Text>
        <Text style={styles.section}>{t(lang, 'audit')}</Text>
        {events.length === 0 && <Text style={styles.body}>{t(lang, 'noAudit')}</Text>}
        {events.map((event, index) => (
          <Text key={`${event.at}-${event.action}-${index}`} style={styles.body}>
            {event.at.replace('T', ' ').slice(0, 16)} · {event.action} · {event.detail}
          </Text>
        ))}
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'home' })}
        />
      </View>
    );
  } else if (screen.id === 'tools') {
    body = (
      <View style={styles.flex}>
        <CameraButton
          title={t(lang, 'back')}
          tone="secondary"
          onPress={() => setScreen({ id: 'home' })}
        />
        <HomeScreen embedded />
      </View>
    );
  }

  if (!uid) return null;
  if (!booted) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={cameraColors.primary} />
        <Text style={styles.body}>{t(lang, 'loading')}</Text>
      </View>
    );
  }
  if (locked) {
    return (
      <View style={styles.boot}>
        <Text style={styles.body}>{t(lang, 'vaultLocked')}</Text>
        <Text style={styles.body}>{t(lang, 'vaultResetHint')}</Text>
        <CameraButton
          title={t(lang, 'vaultReset')}
          disabled={resetting}
          onPress={() => void resetVault()}
        />
        <CameraButton
          title={t(lang, 'signOut')}
          tone="secondary"
          onPress={() => void auth.logout()}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.email} numberOfLines={1}>
          {email}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(lang, 'signOut')}
          onPress={() => void signOut()}
        >
          <Text style={styles.signOut}>{t(lang, 'signOut')}</Text>
        </Pressable>
      </View>
      {auth.biometricOfferVisible && (
        <View style={styles.offer}>
          <Text style={styles.cardTitle}>{t(lang, 'biometricTitle')}</Text>
          <CameraButton
            title={t(lang, 'biometricYes')}
            onPress={() => void auth.enableBiometric()}
          />
          <CameraButton
            title={t(lang, 'biometricLater')}
            tone="secondary"
            onPress={() => void auth.dismissBiometricPrompt()}
          />
        </View>
      )}
      {banner && <Text style={styles.warn}>{banner}</Text>}
      {fullScreen ? (
        <View style={styles.flex}>{body}</View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      )}
    </View>
  );
}

function SessionLine({
  session,
  lang,
  onPress,
}: {
  session: ExamSession;
  lang: ClinicSettings['language'];
  onPress: () => void;
}) {
  const value = primaryNumber(session);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.card}>
      <Text style={styles.cardTitle}>{testInfo(lang, session.testId).title}</Text>
      <Text style={{ color: flagColor[qualityRank(session)] }}>
        {session.createdAt.replace('T', ' ').slice(0, 16)} · {value ?? '—'}{' '}
        {session.rows[0]?.unit ?? ''}
      </Text>
    </Pressable>
  );
}

function RowSwitch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.body}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 28) : 48;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: cameraColors.background },
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: cameraColors.background,
  },
  bar: {
    paddingTop: topInset,
    paddingHorizontal: 16,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  email: { flex: 1, color: cameraColors.muted, fontSize: 14 },
  signOut: { color: cameraColors.primary, fontSize: 15, fontWeight: '700' },
  offer: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: cameraColors.soft,
    gap: 8,
  },
  content: { padding: 16, paddingBottom: 48 },
  flex: { flex: 1 },
  stack: { gap: 12 },
  title: { fontSize: 28, fontWeight: '800', color: cameraColors.ink },
  section: { marginTop: 8, color: cameraColors.ink, fontSize: 16, fontWeight: '800' },
  body: { color: cameraColors.muted, fontSize: 15, lineHeight: 22 },
  warn: { color: cameraColors.danger, fontSize: 15, lineHeight: 22, marginHorizontal: 16 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: cameraColors.border,
  },
  cardTitle: { color: cameraColors.ink, fontSize: 16, fontWeight: '800' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: cameraColors.border,
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: cameraColors.ink,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  track: { height: 8, backgroundColor: cameraColors.soft, borderRadius: 4, marginBottom: 6 },
  meter: { height: 8, borderRadius: 4 },
});
