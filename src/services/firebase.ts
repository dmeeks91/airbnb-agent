import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getMessaging, getToken, isSupported, type Messaging } from 'firebase/messaging';

interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

function normalizeEnvString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readFirebaseConfig(): FirebaseClientConfig {
  const env = import.meta.env;
  return {
    apiKey: normalizeEnvString(env?.VITE_FIREBASE_API_KEY),
    authDomain: normalizeEnvString(env?.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: normalizeEnvString(env?.VITE_FIREBASE_PROJECT_ID),
    storageBucket: normalizeEnvString(env?.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: normalizeEnvString(env?.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: normalizeEnvString(env?.VITE_FIREBASE_APP_ID),
    vapidKey: normalizeEnvString(env?.VITE_FIREBASE_VAPID_KEY),
  };
}

export interface FirebaseClientServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  vapidKey: string;
}

let cachedServices: FirebaseClientServices | null = null;
let cachedMessaging: Messaging | null = null;

export function isFirebaseConfigured(): boolean {
  const config = readFirebaseConfig();
  return Boolean(config.apiKey && config.projectId && config.appId);
}

export function getFirebaseServices(): FirebaseClientServices | null {
  if (!isFirebaseConfigured()) {
    return null;
  }

  if (cachedServices) {
    return cachedServices;
  }

  const config = readFirebaseConfig();
  const existingApps = getApps();
  const app =
    existingApps.length > 0
      ? existingApps[0]
      : initializeApp({
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          projectId: config.projectId,
          storageBucket: config.storageBucket,
          messagingSenderId: config.messagingSenderId,
          appId: config.appId,
        });

  const auth = getAuth(app);
  let db: Firestore;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    db = getFirestore(app);
  }

  cachedServices = {
    app,
    auth,
    db,
    vapidKey: config.vapidKey,
  };
  return cachedServices;
}

export async function getCurrentIdToken(): Promise<string | null> {
  const services = getFirebaseServices();
  if (!services || !services.auth.currentUser) {
    return null;
  }
  return services.auth.currentUser.getIdToken();
}

export async function signInWithGoogle(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) {
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(services.auth, provider);
}

export async function signOutHost(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) {
    return;
  }
  await signOut(services.auth);
}

export async function requestWebPushToken(): Promise<string | null> {
  const services = getFirebaseServices();
  if (!services || !services.vapidKey) {
    return null;
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return null;
  }
  const messagingSupported = await isSupported();
  if (!messagingSupported) {
    return null;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return null;
  }

  if (!cachedMessaging) {
    cachedMessaging = getMessaging(services.app);
  }

  const registration =
    'serviceWorker' in navigator
      ? await navigator.serviceWorker.register('/firebase-messaging-sw.js')
      : undefined;

  const token = await getToken(cachedMessaging, {
    vapidKey: services.vapidKey,
    serviceWorkerRegistration: registration,
  });

  return token || null;
}
