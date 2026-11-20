import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { HavenStore } from '../services/havenStore.ts';
import { requestAssignUnmatched } from '../services/apiClient.ts';
import {
  findPropertyById,
  getOtherPropertiesUnreadCount,
} from '../utils/propertyHelpers.ts';

export function useProperties(store: HavenStore, activePropertyId: string) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const activeProperty = useMemo(
    () => findPropertyById(snapshot.properties, activePropertyId) ?? snapshot.properties[0],
    [snapshot.properties, activePropertyId],
  );

  const otherPropertiesUnreadCount = useMemo(
    () =>
      activeProperty
        ? getOtherPropertiesUnreadCount(snapshot.properties, activeProperty.id)
        : 0,
    [snapshot.properties, activeProperty],
  );

  const unresolvedUnmatched = useMemo(
    () => snapshot.unmatchedEmails.filter((item) => !item.resolved),
    [snapshot.unmatchedEmails],
  );

  const assignUnmatched = useCallback(
    async (unmatchedId: string, targetPropertyId: string): Promise<string | null> => {
      if (store.mode === 'firestore') {
        try {
          const response = await requestAssignUnmatched(unmatchedId, {
            propertyId: targetPropertyId,
          });
          return response.threadId;
        } catch {
          const localFallback = await store.assignUnmatchedEmail(
            unmatchedId,
            targetPropertyId,
          );
          return localFallback?.id ?? null;
        }
      }
      const assigned = await store.assignUnmatchedEmail(unmatchedId, targetPropertyId);
      return assigned?.id ?? null;
    },
    [store],
  );

  return {
    properties: snapshot.properties,
    activeProperty,
    otherPropertiesUnreadCount,
    unresolvedUnmatched,
    ingestionHealth: snapshot.ingestionHealth,
    voiceProfile: snapshot.voiceProfile,
    userProfile: snapshot.userProfile,
    allowedEmails: snapshot.allowedEmails,
    assignUnmatched,
  };
}
