import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CohostStore, UpsertPropertyInput } from '../services/cohostStore.ts';
import {
  requestAssignUnmatched,
  requestDeleteUnmatched,
} from '../services/apiClient.ts';
import type { Property } from '../types/cohost.ts';
import {
  findPropertyById,
  getOtherPropertiesUnreadCount,
  sortProperties,
} from '../utils/propertyHelpers.ts';

export function useProperties(store: CohostStore, activePropertyId: string) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const orderedProperties = useMemo(
    () => sortProperties(snapshot.properties),
    [snapshot.properties],
  );

  const activeProperty = useMemo(
    () => findPropertyById(orderedProperties, activePropertyId) ?? orderedProperties[0],
    [orderedProperties, activePropertyId],
  );

  const otherPropertiesUnreadCount = useMemo(
    () =>
      activeProperty
        ? getOtherPropertiesUnreadCount(orderedProperties, activeProperty.id)
        : 0,
    [orderedProperties, activeProperty],
  );

  const unresolvedUnmatched = useMemo(
    () => snapshot.unmatchedEmails.filter((item) => !item.resolved),
    [snapshot.unmatchedEmails],
  );

  const saveProperty = useCallback(
    (input: UpsertPropertyInput): Promise<Property> => store.upsertProperty(input),
    [store],
  );

  const reorderProperties = useCallback(
    (orderedIds: readonly string[]): Promise<void> => store.reorderProperties(orderedIds),
    [store],
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

  const deleteUnmatched = useCallback(
    async (unmatchedId: string): Promise<void> => {
      if (store.mode === 'firestore') {
        try {
          await requestDeleteUnmatched(unmatchedId);
          return;
        } catch {
          await store.deleteUnmatchedEmail(unmatchedId);
          return;
        }
      }
      await store.deleteUnmatchedEmail(unmatchedId);
    },
    [store],
  );

  return {
    properties: orderedProperties,
    activeProperty,
    otherPropertiesUnreadCount,
    unresolvedUnmatched,
    ingestionHealth: snapshot.ingestionHealth,
    voiceProfile: snapshot.voiceProfile,
    userProfile: snapshot.userProfile,
    allowedEmails: snapshot.allowedEmails,
    saveProperty,
    reorderProperties,
    assignUnmatched,
    deleteUnmatched,
  };
}
