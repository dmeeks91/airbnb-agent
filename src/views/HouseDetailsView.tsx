import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  Home,
  KeyRound,
  Link2,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  Sliders,
  StickyNote,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { PropertySwitcher } from '../components/PropertySwitcher.tsx';
import { SearchInput } from '../components/ui/SearchInput.tsx';
import { VendorDetailsSheet } from '../components/VendorDetailsSheet.tsx';
import type { UpsertRuleInput } from '../services/cohostStore.ts';
import type {
  HouseRule,
  Property,
  PropertyPricing,
  PropertyVendor,
  RuleCategory,
} from '../types/cohost.ts';
import { formatCalendarDate } from '../utils/dateFormat.ts';
import {
  dedupeListingTitleAliases,
  getPropertyDisplayLabel,
  getPropertyTheme,
} from '../utils/propertyHelpers.ts';
import { groupRulesByCategory, isRuleExpired } from '../utils/ruleFilters.ts';
import { RuleDetailsSheet } from './RuleDetailsSheet.tsx';

export interface HouseDetailsViewProps {
  properties: readonly Property[];
  activeProperty: Property;
  otherPropertiesUnreadCount: number;
  rules: readonly HouseRule[];
  onSelectProperty: (propertyId: string) => void;
  onAddProperty: () => void;
  onReorderProperties: (orderedIds: readonly string[]) => Promise<void>;
  onEditProperty: (property: Property) => void;
  onOpenImport: () => void;
  onSaveRule: (input: UpsertRuleInput) => Promise<void>;
  onDeleteRule: (ruleId: string) => Promise<void>;
  onSavePricing: (pricing: PropertyPricing) => Promise<void>;
  onSaveSignOffOverride: (signOffOverride: string | null) => Promise<void>;
  onSaveVendor: (vendor: PropertyVendor) => Promise<void>;
  onDeleteVendor: (vendorId: string) => Promise<void>;
}

function getCategoryIcon(category: RuleCategory) {
  if (category === 'Access & Arrival') {
    return <KeyRound className="w-4 h-4" aria-hidden="true" />;
  }
  if (category === 'Timings & Rates') {
    return <Clock className="w-4 h-4" aria-hidden="true" />;
  }
  return <Home className="w-4 h-4" aria-hidden="true" />;
}

function PricingGuardrailsCard({
  property,
  onSavePricing,
  onSaveSignOffOverride,
}: {
  property: Property;
  onSavePricing: (pricing: PropertyPricing) => Promise<void>;
  onSaveSignOffOverride: (signOffOverride: string | null) => Promise<void>;
}) {
  const [draftNightlyFloor, setDraftNightlyFloor] = useState<string | null>(null);
  const [draftCleaningFee, setDraftCleaningFee] = useState<string | null>(null);
  const [draftLocalTaxPct, setDraftLocalTaxPct] = useState<string | null>(null);
  const [draftHostServiceFeePct, setDraftHostServiceFeePct] = useState<string | null>(null);
  const [draftSignOffOverride, setDraftSignOffOverride] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const nightlyFloor = draftNightlyFloor ?? String(property.pricing.nightlyFloor);
  const cleaningFee = draftCleaningFee ?? String(property.pricing.cleaningFee);
  const localTaxPct = draftLocalTaxPct ?? String(property.pricing.localTaxPct);
  const hostServiceFeePct =
    draftHostServiceFeePct ?? String(property.pricing.hostServiceFeePct);
  const signOffOverride = draftSignOffOverride ?? (property.signOffOverride ?? '');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedFloor = Number.parseFloat(nightlyFloor);
    const parsedCleaning = Number.parseFloat(cleaningFee);
    const parsedTax = Number.parseFloat(localTaxPct);
    const parsedHostFee = Number.parseFloat(hostServiceFeePct);
    const parsedPricing: PropertyPricing = {
      nightlyFloor: Math.max(0, Number.isFinite(parsedFloor) ? parsedFloor : 0),
      cleaningFee: Math.max(0, Number.isFinite(parsedCleaning) ? parsedCleaning : 0),
      localTaxPct: Math.max(0, Number.isFinite(parsedTax) ? parsedTax : 0),
      hostServiceFeePct: Math.min(
        99,
        Math.max(0, Number.isFinite(parsedHostFee) ? parsedHostFee : 15.5),
      ),
    };
    await onSavePricing(parsedPricing);
    await onSaveSignOffOverride(signOffOverride.trim() || null);
    setDraftNightlyFloor(null);
    setDraftCleaningFee(null);
    setDraftLocalTaxPct(null);
    setDraftHostServiceFeePct(null);
    setDraftSignOffOverride(null);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <section className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-3">
      <div>
        <h2 className="font-label text-label-lg font-semibold text-light-on-surface">
          Pricing Guardrails &amp; Host Sign-Off
        </h2>
        <p className="text-body-sm text-light-secondary">
          Min nightly payout stays strictly private from guests and powers the 15.5% net payout check.
        </p>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
              Min Nightly Payout ($)
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={nightlyFloor}
              onChange={(event) => setDraftNightlyFloor(event.target.value)}
              className="min-h-[40px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md font-code text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
              Cleaning Fee ($)
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={cleaningFee}
              onChange={(event) => setDraftCleaningFee(event.target.value)}
              className="min-h-[40px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md font-code text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
              Local Tax (%)
            </span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={localTaxPct}
              onChange={(event) => setDraftLocalTaxPct(event.target.value)}
              className="min-h-[40px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md font-code text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
              Host Fee (%)
            </span>
            <input
              type="number"
              min="0"
              max="99"
              step="0.1"
              value={hostServiceFeePct}
              onChange={(event) => setDraftHostServiceFeePct(event.target.value)}
              className="min-h-[40px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md font-code text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
            Per-Property Sign-Off Override (Optional)
          </span>
          <input
            type="text"
            value={signOffOverride}
            onChange={(event) => setDraftSignOffOverride(event.target.value)}
            placeholder="Leave blank to use global Account sign-off"
            className="min-h-[40px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
          />
        </label>

        <button
          type="submit"
          className="w-full min-h-[40px] px-3 py-2 rounded-md bg-light-primary text-white font-label text-label-md font-semibold flex items-center justify-center gap-1.5 hover:opacity-95 transition"
        >
          {savedNotice ? (
            <>
              <Check className="w-4 h-4" aria-hidden="true" />
              <span>Guardrails Saved</span>
            </>
          ) : (
            <span>Save Pricing &amp; Sign-Off</span>
          )}
        </button>
      </form>
    </section>
  );
}

export function HouseDetailsView({
  properties,
  activeProperty,
  otherPropertiesUnreadCount,
  rules,
  onSelectProperty,
  onAddProperty,
  onReorderProperties,
  onEditProperty,
  onOpenImport,
  onSaveRule,
  onDeleteRule,
  onSavePricing,
  onSaveSignOffOverride,
  onSaveVendor,
  onDeleteVendor,
}: HouseDetailsViewProps) {
  const [isSourcesExpanded, setIsSourcesExpanded] = useState(true);
  const [ruleSearch, setRuleSearch] = useState('');
  const [isRuleSheetOpen, setIsRuleSheetOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<HouseRule | null>(null);
  const [isVendorSheetOpen, setIsVendorSheetOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<PropertyVendor | null>(null);
  const [copiedRuleId, setCopiedRuleId] = useState<string | null>(null);

  const theme = getPropertyTheme(activeProperty.code);

  const filteredGroupedRules = useMemo(() => {
    const query = ruleSearch.trim().toLowerCase();
    const filtered = query
      ? rules.filter((rule) =>
          `${rule.topic} ${rule.value} ${rule.category}`.toLowerCase().includes(query),
        )
      : rules;
    return groupRulesByCategory(filtered);
  }, [rules, ruleSearch]);

  const openCreateRule = () => {
    setEditingRule(null);
    setIsRuleSheetOpen(true);
  };

  const openEditRule = (rule: HouseRule) => {
    setEditingRule(rule);
    setIsRuleSheetOpen(true);
  };

  const handleCopyRule = async (rule: HouseRule) => {
    try {
      await navigator.clipboard?.writeText(rule.value);
    } catch {
      // Clipboard unavailable
    }
    setCopiedRuleId(rule.id);
    setTimeout(() => {
      setCopiedRuleId((prev) => (prev === rule.id ? null : prev));
    }, 1500);
  };

  return (
    <div className="flex flex-col flex-1 pb-24">
      <header className="px-4 py-3 border-b border-light-outline-variant bg-light-surface sticky top-0 z-20 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-headline text-headline-sm text-light-on-surface leading-tight">
            House Details
          </h1>
          <div className="flex items-center gap-1.5 text-body-sm text-light-secondary truncate">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${theme.dotBg}`}
              aria-hidden="true"
            />
            <span className={`font-label text-label-sm font-semibold truncate ${theme.text}`}>
              {getPropertyDisplayLabel(activeProperty)}
            </span>
          </div>
        </div>

        <PropertySwitcher
          properties={properties}
          activePropertyId={activeProperty.id}
          otherPropertiesUnreadCount={otherPropertiesUnreadCount}
          onSelectProperty={onSelectProperty}
          onAddProperty={onAddProperty}
          onReorderProperties={onReorderProperties}
        />
      </header>

      <main className="px-4 py-3 flex flex-col gap-4 flex-1">
        <section className="bg-white rounded-lg border border-light-outline-variant overflow-hidden flex flex-col">
          <div className="px-3.5 py-2.5 bg-light-surface-container-low border-b border-light-outline-variant flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsSourcesExpanded((prev) => !prev)}
              aria-expanded={isSourcesExpanded}
              className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
            >
              <FolderOpen className={`w-4 h-4 shrink-0 ${theme.text}`} aria-hidden="true" />
              <h2 className="font-label text-label-md font-semibold text-light-on-surface truncate">
                Knowledge Sources ({activeProperty.knowledgeSources.length})
              </h2>
              {isSourcesExpanded ? (
                <ChevronUp className="w-4 h-4 text-light-secondary shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 text-light-secondary shrink-0" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={onOpenImport}
              className="min-h-[34px] px-2.5 py-1 rounded-md bg-light-primary text-white font-label text-label-sm font-semibold flex items-center gap-1 shrink-0 hover:opacity-95 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Import</span>
            </button>
          </div>

          {isSourcesExpanded && (
            <div className="p-2.5 flex flex-col gap-1.5 max-h-32 overflow-y-auto overscroll-contain">
              {activeProperty.knowledgeSources.length === 0 && (
                <p className="text-body-sm text-light-secondary px-1 py-2">
                  No sources imported yet. Tap Import to paste listing notes or upload a PDF guidebook.
                </p>
              )}
              {activeProperty.knowledgeSources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center gap-2.5 p-2 rounded-md bg-light-surface-container-low border border-light-outline-variant/70"
                >
                  {source.type === 'pdf_upload' ? (
                    <FileText className="w-4 h-4 text-purple-700 shrink-0" aria-hidden="true" />
                  ) : source.type === 'url_import' ? (
                    <Link2 className="w-4 h-4 text-property-a shrink-0" aria-hidden="true" />
                  ) : (
                    <StickyNote className={`w-4 h-4 shrink-0 ${theme.text}`} aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="font-label text-label-sm font-semibold text-light-on-surface block truncate">
                      {source.title}
                    </span>
                    <span className="text-[11px] text-light-secondary font-code block truncate">
                      {source.ruleCount} rules · {formatCalendarDate(source.uploadedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Link2 className={`w-4 h-4 shrink-0 ${theme.text}`} aria-hidden="true" />
              <h2 className="font-label text-label-md font-semibold text-light-on-surface truncate">
                Airbnb Listing Match
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onEditProperty(activeProperty)}
              className={`min-h-[34px] px-2.5 py-1 rounded-md border border-light-outline-variant bg-white font-label text-label-sm font-semibold flex items-center gap-1 hover:bg-stone-50 transition shrink-0 ${theme.text}`}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Edit Listing</span>
            </button>
          </div>

          <div className="flex flex-col gap-1.5 text-body-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-light-secondary">Listing ID</span>
              <span className="font-code text-[12px] text-light-on-surface truncate">
                {activeProperty.airbnbListingIds.length > 0
                  ? activeProperty.airbnbListingIds.join(', ')
                  : 'Not set yet'}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-light-secondary shrink-0">Listing Title</span>
              <span className="text-right text-light-on-surface break-words">
                {(() => {
                  const cleanTitles = dedupeListingTitleAliases(activeProperty.titleAliases);
                  return cleanTitles.length > 0
                    ? cleanTitles.join(' · ')
                    : 'Auto-learned from emails';
                })()}
              </span>
            </div>
            {activeProperty.welcomeGuideUrl && (
              <div className="flex items-center justify-between gap-3 pt-0.5">
                <span className="text-light-secondary shrink-0">Welcome Guide</span>
                <a
                  href={activeProperty.welcomeGuideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-code text-[12px] text-property-a underline truncate"
                >
                  {activeProperty.welcomeGuideUrl}
                </a>
              </div>
            )}
          </div>
        </section>

        <PricingGuardrailsCard
          key={activeProperty.id}
          property={activeProperty}
          onSavePricing={onSavePricing}
          onSaveSignOffOverride={onSaveSignOffOverride}
        />

        <SearchInput
          value={ruleSearch}
          onChange={setRuleSearch}
          placeholder="Search rules (e.g. wifi, trash, crib, code)..."
          variant="rounded"
        />

        <section className="bg-white rounded-lg border border-light-outline-variant overflow-hidden flex flex-col">
          <div className="px-3.5 py-2.5 bg-light-surface-container-low border-b border-light-outline-variant flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Sliders className={`w-4 h-4 ${theme.text}`} aria-hidden="true" />
              <h2 className="font-label text-label-md font-semibold text-light-on-surface">
                Live Operational Values
              </h2>
            </div>
            <button
              type="button"
              onClick={openCreateRule}
              className={`min-h-[34px] px-2.5 py-1 rounded-md border border-light-outline-variant bg-white font-label text-label-sm font-semibold flex items-center gap-1 hover:bg-stone-50 transition ${theme.text}`}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Rule</span>
            </button>
          </div>

          <div className="max-h-[46vh] overflow-y-auto overscroll-contain divide-y divide-light-outline-variant/60">
            {filteredGroupedRules.map(({ category, rules: categoryRules }) => (
              <div key={category}>
                <div className="px-3.5 py-1.5 bg-stone-50 border-b border-light-outline-variant/60 flex items-center justify-between sticky top-0 z-10">
                  <span className="font-label text-[11px] uppercase tracking-wider text-light-secondary font-semibold">
                    {category}
                  </span>
                  <span className="text-[10px] text-light-secondary font-code">
                    {categoryRules.length}{' '}
                    {categoryRules.length === 1 ? 'rule' : 'rules'}
                  </span>
                </div>

                {categoryRules.length === 0 && (
                  <p className="px-3.5 py-2.5 text-body-sm text-light-outline">
                    No matching rules in {category}.
                  </p>
                )}

                {categoryRules.map((rule) => {
                  const expired = isRuleExpired(rule);
                  return (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between gap-2 hover:bg-light-surface-container-low/60 transition"
                    >
                      <button
                        type="button"
                        onClick={() => openEditRule(rule)}
                        className="flex items-center gap-3 min-w-0 flex-1 p-3 text-left"
                      >
                        <span
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${theme.softBg} ${theme.text} ${theme.softBorder}`}
                        >
                          {getCategoryIcon(rule.category)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-light-secondary text-[11px] font-label uppercase tracking-wider font-semibold">
                              {rule.topic}
                            </span>
                            {rule.isTemporary && rule.expiresAt && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-code font-semibold ${
                                  expired
                                    ? 'bg-stone-200 text-slate-600 line-through'
                                    : 'bg-warning-surface text-warning'
                                }`}
                              >
                                {expired
                                  ? 'Expired'
                                  : `Temp · ${formatCalendarDate(rule.expiresAt)}`}
                              </span>
                            )}
                          </div>
                          <p className="text-body-sm font-medium text-light-on-surface truncate mt-0.5">
                            {rule.value}
                          </p>
                        </div>
                        <ChevronRight
                          className="w-4 h-4 text-light-outline shrink-0"
                          aria-hidden="true"
                        />
                      </button>

                      {rule.category === 'Access & Arrival' && (
                        <button
                          type="button"
                          onClick={() => void handleCopyRule(rule)}
                          aria-label={`Copy ${rule.topic}`}
                          className="mr-2 w-9 h-9 rounded-md text-light-secondary hover:text-light-on-surface hover:bg-stone-100 flex items-center justify-center shrink-0 transition"
                        >
                          {copiedRuleId === rule.id ? (
                            <Check className="w-4 h-4 text-success" aria-hidden="true" />
                          ) : (
                            <Copy className="w-4 h-4" aria-hidden="true" />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <PhoneCall className={`w-4 h-4 ${theme.text}`} aria-hidden="true" />
              <h2 className="font-label text-label-md font-semibold text-light-on-surface">
                Vendor Contacts
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingVendor(null);
                setIsVendorSheetOpen(true);
              }}
              className={`min-h-[34px] px-2.5 py-1 rounded-md border border-light-outline-variant bg-white font-label text-label-sm font-semibold flex items-center gap-1 hover:bg-stone-50 transition ${theme.text}`}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Vendor</span>
            </button>
          </div>

          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto overscroll-contain">
            {activeProperty.vendors.length === 0 && (
              <p className="text-body-sm text-light-secondary">
                No vendor contacts saved for this property yet.
              </p>
            )}
            {activeProperty.vendors.map((vendor) => (
              <div
                key={vendor.id}
                className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-light-surface-container-low border border-light-outline-variant/70"
              >
                <button
                  type="button"
                  onClick={() => {
                    setEditingVendor(vendor);
                    setIsVendorSheetOpen(true);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="font-label text-label-md font-semibold text-light-on-surface block truncate">
                    {vendor.name} ({vendor.role})
                  </span>
                  <span className="text-[11px] text-light-secondary font-code block truncate">
                    {vendor.phone}
                    {vendor.notes ? ` · ${vendor.notes}` : ''}
                  </span>
                </button>

                <a
                  href={`tel:${vendor.phone.replace(/[^+\d]/g, '')}`}
                  aria-label={`Call ${vendor.name}`}
                  className="w-9 h-9 rounded-full bg-white border border-light-outline-variant text-light-secondary hover:text-property-a flex items-center justify-center shrink-0 transition"
                >
                  <Phone className="w-4 h-4" aria-hidden="true" />
                </a>
              </div>
            ))}
          </div>
        </section>
      </main>

      <RuleDetailsSheet
        isOpen={isRuleSheetOpen}
        rule={editingRule}
        onClose={() => setIsRuleSheetOpen(false)}
        onSave={onSaveRule}
        onDelete={onDeleteRule}
      />

      <VendorDetailsSheet
        isOpen={isVendorSheetOpen}
        vendor={editingVendor}
        onClose={() => setIsVendorSheetOpen(false)}
        onSave={onSaveVendor}
        onDelete={onDeleteVendor}
      />
    </div>
  );
}
