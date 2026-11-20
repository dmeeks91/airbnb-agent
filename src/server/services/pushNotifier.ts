import type { Messaging as AdminMessaging } from 'firebase-admin/messaging';
import { getFirebaseAdminServices } from '../config/firebaseAdmin.ts';

export interface PushNotificationPayload {
  title: string;
  body: string;
  propertyId?: string;
  threadId?: string;
  view?: 'messages' | 'dialogue';
}

export interface PushRecipient {
  uid: string;
  tokens: string[];
}

export interface PushNotifierDeps {
  messaging?: Pick<AdminMessaging, 'sendEachForMulticast'> | null;
  loadRecipients: () => Promise<PushRecipient[]>;
  removeStaleTokens: (uid: string, staleTokens: string[]) => Promise<void>;
  appOrigin?: string;
}

const STALE_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export interface PushDispatchResult {
  sentCount: number;
  failedCount: number;
  removedStaleTokens: string[];
}

export function buildDeepLinkPath(payload: PushNotificationPayload): string {
  const params = new URLSearchParams();
  if (payload.propertyId) {
    params.set('propertyId', payload.propertyId);
  }
  if (payload.threadId) {
    params.set('threadId', payload.threadId);
  }
  if (payload.view) {
    params.set('view', payload.view);
  }
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export async function sendAndroidPushNotification(
  payload: PushNotificationPayload,
  deps: PushNotifierDeps,
): Promise<PushDispatchResult> {
  const messaging = deps.messaging ?? getFirebaseAdminServices()?.messaging ?? null;
  if (!messaging) {
    return { sentCount: 0, failedCount: 0, removedStaleTokens: [] };
  }

  const recipients = await deps.loadRecipients();
  const deepLinkPath = buildDeepLinkPath(payload);
  const origin = (deps.appOrigin ?? process.env.APP_ORIGIN ?? '').replace(/\/$/, '');
  const fullUrl = origin ? `${origin}${deepLinkPath}` : deepLinkPath;

  let sentCount = 0;
  let failedCount = 0;
  const removedStaleTokens: string[] = [];

  for (const recipient of recipients) {
    if (recipient.tokens.length === 0) {
      continue;
    }

    const batchResponse = await messaging.sendEachForMulticast({
      tokens: recipient.tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        propertyId: payload.propertyId ?? '',
        threadId: payload.threadId ?? '',
        view: payload.view ?? 'messages',
        url: deepLinkPath,
      },
      webpush: {
        fcmOptions: {
          link: fullUrl,
        },
        notification: {
          tag: payload.threadId ? `cohost-thread-${payload.threadId}` : 'cohost-alert',
          renotify: true,
        },
      },
    });

    const staleForUser: string[] = [];
    batchResponse.responses.forEach((resp, idx) => {
      if (resp.success) {
        sentCount++;
      } else {
        failedCount++;
        const code = resp.error?.code;
        if (code && STALE_TOKEN_ERROR_CODES.has(code)) {
          const deadToken = recipient.tokens[idx];
          if (deadToken) {
            staleForUser.push(deadToken);
            removedStaleTokens.push(deadToken);
          }
        }
      }
    });

    if (staleForUser.length > 0) {
      await deps.removeStaleTokens(recipient.uid, staleForUser);
    }
  }

  return { sentCount, failedCount, removedStaleTokens };
}
