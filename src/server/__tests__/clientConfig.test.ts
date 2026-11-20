import { describe, expect, it } from 'vitest';
import {
  injectFirebaseClientConfig,
  readPublicFirebaseClientConfig,
} from '../config/clientConfig.ts';

const SAMPLE_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <title>Guest Co-Host</title>',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
].join('\n');

describe('runtime Firebase public client config injection', () => {
  it('returns null and leaves HTML untouched when Firebase web env vars are absent', () => {
    const env: NodeJS.ProcessEnv = {
      GMAIL_OAUTH_CLIENT_SECRET: 'super-secret-value',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh-secret-value',
    };

    expect(readPublicFirebaseClientConfig(env)).toBeNull();
    expect(injectFirebaseClientConfig(SAMPLE_HTML, env)).toBe(SAMPLE_HTML);
  });

  it('injects only the 7 allowlisted public Firebase web fields and never leaks server secrets', () => {
    const env: NodeJS.ProcessEnv = {
      VITE_FIREBASE_API_KEY: 'AIzaSyPublicKey123',
      VITE_FIREBASE_AUTH_DOMAIN: 'guest-cohost-prod.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'guest-cohost-prod',
      VITE_FIREBASE_STORAGE_BUCKET: 'guest-cohost-prod.firebasestorage.app',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
      VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
      VITE_FIREBASE_VAPID_KEY: 'BPushPublicVapidKey',
      GMAIL_OAUTH_CLIENT_SECRET: 'DO-NOT-LEAK-SECRET',
      GMAIL_OAUTH_REFRESH_TOKEN: 'DO-NOT-LEAK-REFRESH',
      GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json',
    };

    const rendered = injectFirebaseClientConfig(SAMPLE_HTML, env);

    expect(rendered).toContain('window.__COHOST_FIREBASE_CONFIG__=');
    expect(rendered).toContain('AIzaSyPublicKey123');
    expect(rendered).toContain('guest-cohost-prod');
    expect(rendered).toContain('BPushPublicVapidKey');
    expect(rendered).not.toContain('DO-NOT-LEAK-SECRET');
    expect(rendered).not.toContain('DO-NOT-LEAK-REFRESH');
    expect(rendered).not.toContain('/secrets/sa.json');
  });

  it('escapes HTML-significant characters so values cannot break out of the inline script tag', () => {
    const env: NodeJS.ProcessEnv = {
      VITE_FIREBASE_API_KEY: 'key</script><img src=x>',
      VITE_FIREBASE_PROJECT_ID: 'proj&test',
      VITE_FIREBASE_APP_ID: 'app-id',
    };

    const rendered = injectFirebaseClientConfig(SAMPLE_HTML, env);
    expect(rendered).not.toContain('</script><img');
    expect(rendered).toContain('\\u003c/script\\u003e\\u003cimg');
    expect(rendered).toContain('proj\\u0026test');
  });
});
