import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CohostStore, UpsertRuleInput } from '../services/cohostStore.ts';
import type {
  ExtractedRuleCandidate,
  KnowledgeSourceType,
  PropertyPricing,
  PropertyVendor,
} from '../types/cohost.ts';
import { filterActiveRules, groupRulesByCategory } from '../utils/ruleFilters.ts';

export function usePropertyRules(store: CohostStore, propertyId: string) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const allRules = useMemo(() => snapshot.rules[propertyId] ?? [], [snapshot.rules, propertyId]);

  const activeRules = useMemo(() => filterActiveRules(allRules), [allRules]);

  const groupedRules = useMemo(() => groupRulesByCategory(allRules), [allRules]);

  const saveRule = useCallback(
    (input: UpsertRuleInput) => store.upsertRule(propertyId, input),
    [store, propertyId],
  );

  const removeRule = useCallback(
    (ruleId: string) => store.deleteRule(propertyId, ruleId),
    [store, propertyId],
  );

  const mergeImported = useCallback(
    (
      sourceTitle: string,
      sourceType: KnowledgeSourceType,
      candidates: readonly ExtractedRuleCandidate[],
    ) => store.mergeImportedRules(propertyId, sourceTitle, sourceType, candidates),
    [store, propertyId],
  );

  const savePricing = useCallback(
    (pricing: PropertyPricing) => store.updatePropertyPricing(propertyId, pricing),
    [store, propertyId],
  );

  const saveSignOffOverride = useCallback(
    (signOffOverride: string | null) =>
      store.updatePropertySignOff(propertyId, signOffOverride),
    [store, propertyId],
  );

  const saveVendor = useCallback(
    (vendor: PropertyVendor) => store.upsertVendor(propertyId, vendor),
    [store, propertyId],
  );

  const removeVendor = useCallback(
    (vendorId: string) => store.deleteVendor(propertyId, vendorId),
    [store, propertyId],
  );

  return {
    allRules,
    activeRules,
    groupedRules,
    saveRule,
    removeRule,
    mergeImported,
    savePricing,
    saveSignOffOverride,
    saveVendor,
    removeVendor,
  };
}
