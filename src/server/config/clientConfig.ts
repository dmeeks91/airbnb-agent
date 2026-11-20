import fs from 'node:fs';
import path from 'node:path';

export interface PublicFirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

function readTrimmedEnv(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Extracts strictly the 7 public Firebase Web SDK configuration values from the server
 * environment. Server secrets (Gmail OAuth, credentials, etc.) are never read or exposed.
 */
export function readPublicFirebaseClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublicFirebaseClientConfig | null {
  const config: PublicFirebaseClientConfig = {
    apiKey: readTrimmedEnv(env, 'VITE_FIREBASE_API_KEY'),
    authDomain: readTrimmedEnv(env, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readTrimmedEnv(env, 'VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readTrimmedEnv(env, 'VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readTrimmedEnv(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readTrimmedEnv(env, 'VITE_FIREBASE_APP_ID'),
    vapidKey: readTrimmedEnv(env, 'VITE_FIREBASE_VAPID_KEY'),
  };

  if (!config.apiKey || !config.projectId || !config.appId) {
    return null;
  }

  return config;
}

function serializeSafeInlineJson(value: PublicFirebaseClientConfig): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Injects the public Firebase client config script into the SPA HTML head when configured
 * via Cloud Run runtime environment variables.
 */
export function injectFirebaseClientConfig(
  html: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const config = readPublicFirebaseClientConfig(env);
  if (!config) {
    return html;
  }

  const scriptTag = `<script>window.__COHOST_FIREBASE_CONFIG__=${serializeSafeInlineJson(config)};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `    ${scriptTag}\n  </head>`);
  }
  return `${scriptTag}\n${html}`;
}

export function renderProductionIndexHtml(
  distPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const template = fs.readFileSync(path.join(distPath, 'index.html'), 'utf8');
  return injectFirebaseClientConfig(template, env);
}
