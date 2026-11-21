import { AlertTriangle, Check, Home, Link2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import type { UpsertPropertyInput } from '../services/cohostStore.ts';
import type { Property } from '../types/cohost.ts';
import {
  normalizeWelcomeGuideUrl,
  parseAirbnbListingInput,
} from '../utils/propertyHelpers.ts';
import { BottomSheet } from './ui/BottomSheet.tsx';

export interface PropertyDetailsSheetProps {
  isOpen: boolean;
  property: Property | null;
  onClose: () => void;
  onSave: (input: UpsertPropertyInput) => Promise<Property>;
}

function PropertyFormBody({
  property,
  onClose,
  onSave,
}: {
  property: Property | null;
  onClose: () => void;
  onSave: (input: UpsertPropertyInput) => Promise<Property>;
}) {
  const [name, setName] = useState(property?.name ?? '');
  const [listingInput, setListingInput] = useState(
    property ? property.airbnbListingIds.join(', ') : '',
  );
  const [listingTitle, setListingTitle] = useState(property?.titleAliases[0] ?? '');
  const [welcomeGuideUrl, setWelcomeGuideUrl] = useState(property?.welcomeGuideUrl ?? '');
  const [minNightlyPayout, setMinNightlyPayout] = useState(
    property ? String(property.pricing.nightlyFloor) : '175',
  );
  const [cleaningFee, setCleaningFee] = useState(
    property ? String(property.pricing.cleaningFee) : '110',
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsedListing = useMemo(
    () => parseAirbnbListingInput(listingInput),
    [listingInput],
  );

  const extraLearnedTitles = property ? property.titleAliases.slice(1) : [];
  const canSave = name.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || isSaving) {
      return;
    }

    const trimmedGuideUrl = welcomeGuideUrl.trim();
    const normalizedGuideUrl = normalizeWelcomeGuideUrl(trimmedGuideUrl);
    if (trimmedGuideUrl && !normalizedGuideUrl) {
      setSaveError('Enter a valid https:// Welcome Guide URL or leave it blank.');
      return;
    }

    const parsedPayout = Number.parseFloat(minNightlyPayout);
    const parsedCleaning = Number.parseFloat(cleaningFee);

    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave({
        id: property?.id,
        name: name.trim(),
        airbnbListingIds: parsedListing.listingIds,
        primaryListingTitle: listingTitle.trim() || null,
        welcomeGuideUrl: normalizedGuideUrl,
        nightlyFloor: Math.max(0, Number.isFinite(parsedPayout) ? parsedPayout : 0),
        cleaningFee: Math.max(0, Number.isFinite(parsedCleaning) ? parsedCleaning : 0),
      });
      onClose();
    } catch {
      setSaveError('Could not save this property. Check your connection and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="property-name-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Property Name
        </label>
        <input
          id="property-name-input"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Maple Loft"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="property-listing-url-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Airbnb Listing URL or ID
        </label>
        <input
          id="property-listing-url-input"
          type="text"
          value={listingInput}
          onChange={(event) => setListingInput(event.target.value)}
          placeholder="Paste airbnb.com/rooms/... link or numeric ID"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 font-code text-body-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />

        {parsedListing.listingIds.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {parsedListing.listingIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success-surface border border-green-200 text-success font-code text-[11px] font-medium"
              >
                <Check className="w-3 h-3" aria-hidden="true" />
                <span>Detected ID: {id}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-light-secondary">
            Accepts /rooms/&lt;ID&gt;, /hosting/listings/editor/&lt;ID&gt;, or a raw numeric ID.
          </span>
        )}

        {parsedListing.hasShortShareLink && (
          <div
            role="status"
            className="p-2 rounded-md bg-warning-surface border border-amber-300 text-[11px] text-warning flex items-start gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Short share links (/h/ or abnb.me) hide the numeric ID. Open the link in your browser and copy the airbnb.com/rooms/&lt;ID&gt; URL instead.
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="property-listing-title-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Airbnb Listing Title (Optional)
        </label>
        <input
          id="property-listing-title-input"
          type="text"
          value={listingTitle}
          onChange={(event) => setListingTitle(event.target.value)}
          placeholder="Exact listing title as shown on Airbnb"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
        <span className="text-[11px] text-light-secondary">
          Auto-learned from emails if left blank.
        </span>
        {extraLearnedTitles.length > 0 && (
          <span className="text-[11px] text-light-outline">
            Additional auto-learned titles: {extraLearnedTitles.join(' · ')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="property-welcome-guide-url-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold flex items-center gap-1.5"
        >
          <Link2 className="w-3.5 h-3.5 text-property-a" aria-hidden="true" />
          <span>Guest Welcome Guide URL (Optional)</span>
        </label>
        <input
          id="property-welcome-guide-url-input"
          type="url"
          value={welcomeGuideUrl}
          onChange={(event) => setWelcomeGuideUrl(event.target.value)}
          placeholder="https://example.web.app/welcome-guide"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 font-code text-body-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
        <span className="text-[11px] text-light-secondary">
          Suggested by the AI for confirmed guests (never sent on unconfirmed inquiries).
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
            Min Nightly Payout ($)
          </span>
          <input
            id="property-min-payout-input"
            type="number"
            min="0"
            step="1"
            value={minNightlyPayout}
            onChange={(event) => setMinNightlyPayout(event.target.value)}
            className="min-h-[40px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md font-code text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-label font-semibold text-light-secondary uppercase tracking-wider">
            Cleaning Fee ($)
          </span>
          <input
            id="property-cleaning-fee-input"
            type="number"
            min="0"
            step="1"
            value={cleaningFee}
            onChange={(event) => setCleaningFee(event.target.value)}
            className="min-h-[40px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md font-code text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
          />
        </label>
      </div>

      {!property && (
        <p className="text-[11px] text-light-secondary">
          Defaults to 14% local tax and 15.5% host fee; editable anytime in House Details.
        </p>
      )}

      {saveError && (
        <p role="alert" className="text-body-sm text-warning font-medium">
          {saveError}
        </p>
      )}

      <div className="pt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 min-h-[42px] rounded-md border border-light-outline-variant bg-white font-label text-label-md font-semibold text-light-secondary hover:bg-stone-50 transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSave || isSaving}
          className="flex-1 min-h-[42px] rounded-md bg-light-primary text-white font-label text-label-md font-semibold disabled:opacity-40 hover:opacity-95 transition"
        >
          Save Property
        </button>
      </div>
    </form>
  );
}

export function PropertyDetailsSheet({
  isOpen,
  property,
  onClose,
  onSave,
}: PropertyDetailsSheetProps) {
  return (
    <BottomSheet
      isOpen={isOpen}
      title={property ? 'Edit Property' : 'Add Property'}
      subtitle="Airbnb listing match & pricing guardrails"
      icon={<Home className="w-5 h-5 text-property-a" aria-hidden="true" />}
      onClose={onClose}
    >
      {isOpen && (
        <PropertyFormBody
          key={property?.id ?? 'new-property'}
          property={property}
          onClose={onClose}
          onSave={onSave}
        />
      )}
    </BottomSheet>
  );
}
