import { authRequired, readFirebaseConfig, type FirebasePublicConfig } from './policy';

/** Direct `process.env.EXPO_PUBLIC_*` reads so Expo can inline them into the bundle. */
export function firebaseConfigFromBundle(): FirebasePublicConfig | null {
  return readFirebaseConfig({
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

export function authRequiredFromBundle(): boolean {
  return authRequired({ EXPO_PUBLIC_AUTH_REQUIRED: process.env.EXPO_PUBLIC_AUTH_REQUIRED });
}
