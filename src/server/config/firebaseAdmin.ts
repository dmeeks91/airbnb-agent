import {
  applicationDefault,
  getApps,
  initializeApp,
  type App as AdminApp,
} from 'firebase-admin/app';
import { getAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { getMessaging, type Messaging as AdminMessaging } from 'firebase-admin/messaging';

export interface FirebaseAdminServices {
  app: AdminApp;
  auth: AdminAuth;
  db: AdminFirestore;
  messaging: AdminMessaging;
}

let cachedAdmin: FirebaseAdminServices | null = null;

export function isFirebaseAdminConfigured(): boolean {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    '';
  const hasExplicitCreds = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.K_SERVICE?.trim(),
  );
  return Boolean(projectId && (hasExplicitCreds || process.env.NODE_ENV === 'production'));
}

export function getFirebaseAdminServices(): FirebaseAdminServices | null {
  if (!isFirebaseAdminConfigured()) {
    return null;
  }

  if (cachedAdmin) {
    return cachedAdmin;
  }

  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.FIREBASE_PROJECT_ID?.trim();

  const existing = getApps();
  const app =
    existing.length > 0
      ? existing[0]
      : initializeApp({
          credential: applicationDefault(),
          projectId,
        });

  cachedAdmin = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    messaging: getMessaging(app),
  };

  return cachedAdmin;
}
