import { useCallback, useState, useSyncExternalStore } from 'react';
import { isFirebaseConfigured, requestWebPushToken } from '../services/firebase.ts';
import type { CohostStore } from '../services/cohostStore.ts';

export function usePushNotifications(store: CohostStore) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const togglePushEnabled = useCallback(
    async (nextEnabled: boolean) => {
      setIsUpdating(true);
      setStatusMessage(null);
      try {
        if (nextEnabled && isFirebaseConfigured()) {
          const token = await requestWebPushToken();
          if (!token) {
            setStatusMessage('Notification permission was not granted on this device.');
            await store.updateUserPushPreferences(false);
            return;
          }
          await store.updateUserPushPreferences(true, token);
          setStatusMessage('Android push notifications enabled on this device.');
        } else {
          await store.updateUserPushPreferences(nextEnabled);
          setStatusMessage(
            nextEnabled
              ? 'Push alerts preference enabled (connect Firebase Web Push in Stage 5 for live FCM delivery).'
              : 'Push alerts paused for this device.',
          );
        }
      } finally {
        setIsUpdating(false);
      }
    },
    [store],
  );

  return {
    pushEnabled: snapshot.userProfile.pushEnabled,
    registeredTokenCount: snapshot.userProfile.fcmTokens.length,
    isUpdating,
    statusMessage,
    togglePushEnabled,
  };
}
