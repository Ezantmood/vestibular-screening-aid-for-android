import assert from './assert';
import {
  SESSION_TIMEOUT_MS,
  authRequired,
  decideAuthGate,
  emailError,
  mapAuthError,
  normalizeEmail,
  passwordError,
  readFirebaseConfig,
  registerInputError,
  sessionExpired,
} from '../src/auth/policy';

const verified = { emailVerified: true };
const pending = { emailVerified: false };

function checks() {
  assert.equal(normalizeEmail('  Ada@Clinic.Org '), 'ada@clinic.org');
  assert.equal(emailError(''), 'Hãy nhập email.');
  assert.equal(emailError('ada'), 'Email chưa đúng định dạng.');
  assert.equal(emailError('ada@clinic.org'), null);

  assert.equal(passwordError('short1'), 'Mật khẩu cần ít nhất 8 ký tự.');
  assert.equal(passwordError('longpassword'), 'Mật khẩu cần có chữ và chữ số.');
  assert.equal(passwordError('longpass1'), null);
  assert.equal(
    registerInputError('ada@clinic.org', 'longpass1', 'otherpass1'),
    'Mật khẩu nhập lại chưa khớp.',
  );

  assert.equal(sessionExpired(1_000, 1_000 + SESSION_TIMEOUT_MS - 1), false);
  assert.equal(sessionExpired(1_000, 1_000 + SESSION_TIMEOUT_MS), true);
  assert.equal(sessionExpired(Number.NaN, 1_000), true);

  assert.equal(
    decideAuthGate({
      configured: false,
      account: verified,
      idleExpired: false,
      biometric: 'unlocked',
    }).status,
    'unconfigured',
  );
  const expired = decideAuthGate({
    configured: true,
    account: verified,
    idleExpired: true,
    biometric: 'unlocked',
    notice: 'Phiên đã hết hạn.',
  });
  assert.equal(expired.status, 'signed-out');
  if (expired.status === 'signed-out') assert.equal(expired.notice, 'Phiên đã hết hạn.');

  assert.equal(
    decideAuthGate({
      configured: true,
      account: null,
      idleExpired: false,
      biometric: 'locked',
    }).status,
    'signed-out',
  );
  assert.equal(
    decideAuthGate({
      configured: true,
      account: pending,
      idleExpired: false,
      biometric: 'unlocked',
    }).status,
    'verify-email',
  );
  assert.equal(
    decideAuthGate({
      configured: true,
      account: verified,
      idleExpired: false,
      biometric: 'locked',
    }).status,
    'biometric-lock',
  );
  assert.equal(
    decideAuthGate({
      configured: true,
      account: verified,
      idleExpired: false,
      biometric: 'disabled',
    }).status,
    'ready',
  );

  assert.equal(mapAuthError('auth/email-already-in-use'), 'Email này đã có tài khoản.');
  assert.equal(mapAuthError('auth/network-request-failed').includes('mạng'), true);
  assert.equal(mapAuthError('auth/unknown-code'), 'Không thực hiện được. Hãy thử lại.');

  assert.equal(readFirebaseConfig({}), null);
  const config = readFirebaseConfig({
    EXPO_PUBLIC_FIREBASE_API_KEY: ' key ',
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: 'app.firebaseapp.com',
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'app',
    EXPO_PUBLIC_FIREBASE_APP_ID: '1:2',
  });
  assert.equal(config?.apiKey, 'key');
  assert.equal(config?.projectId, 'app');
  assert.equal(authRequired({}), true);
  assert.equal(authRequired({ EXPO_PUBLIC_AUTH_REQUIRED: '0' }), false);
  assert.equal(authRequired({ EXPO_PUBLIC_AUTH_REQUIRED: '1' }), true);
}

checks();
console.log('auth logic checks passed');
