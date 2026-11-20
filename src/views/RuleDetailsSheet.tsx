import { CalendarClock, FileEdit, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/ui/BottomSheet.tsx';
import { DatePickerPopover } from '../components/ui/DatePickerPopover.tsx';
import { SelectPopover, type SelectOption } from '../components/ui/SelectPopover.tsx';
import type { UpsertRuleInput } from '../services/havenStore.ts';
import type { HouseRule, RuleCategory } from '../types/haven.ts';
import { formatCalendarDate } from '../utils/dateFormat.ts';

export interface RuleDetailsSheetProps {
  isOpen: boolean;
  rule: HouseRule | null;
  onClose: () => void;
  onSave: (input: UpsertRuleInput) => Promise<void>;
  onDelete?: (ruleId: string) => Promise<void>;
}

const CATEGORY_OPTIONS: readonly SelectOption<RuleCategory>[] = [
  {
    value: 'Access & Arrival',
    label: 'Access & Arrival',
    description: 'Wi-Fi, door codes, address (withheld on inquiries)',
    swatchColor: '#095C57',
  },
  {
    value: 'Timings & Rates',
    label: 'Timings & Rates',
    description: 'Check-in, checkout, bag drop, stay terms',
    swatchColor: '#8C4A00',
  },
  {
    value: 'Amenities & Rules',
    label: 'Amenities & Rules',
    description: 'Parking, pets, trash, cribs, appliances',
    swatchColor: '#7F2A44',
  },
];

function RuleFormBody({
  rule,
  onClose,
  onSave,
  onDelete,
}: {
  rule: HouseRule | null;
  onClose: () => void;
  onSave: (input: UpsertRuleInput) => Promise<void>;
  onDelete?: (ruleId: string) => Promise<void>;
}) {
  const [topic, setTopic] = useState(rule?.topic ?? '');
  const [value, setValue] = useState(rule?.value ?? '');
  const [category, setCategory] = useState<RuleCategory>(
    rule?.category ?? 'Amenities & Rules',
  );
  const [isTemporary, setIsTemporary] = useState(rule?.isTemporary ?? false);
  const [expiresAt, setExpiresAt] = useState<string | null>(rule?.expiresAt ?? null);
  const [isSaving, setIsSaving] = useState(false);

  const canSave =
    topic.trim().length > 0 &&
    value.trim().length > 0 &&
    (!isTemporary || Boolean(expiresAt));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({
        id: rule?.id,
        topic: topic.trim(),
        value: value.trim(),
        category,
        origin: rule?.origin ?? 'Host Direct Policy',
        isTemporary,
        expiresAt: isTemporary ? expiresAt : null,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!rule || !onDelete || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onDelete(rule.id);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="rule-topic-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Rule Topic / Key
        </label>
        <input
          id="rule-topic-input"
          type="text"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="e.g. Wi-Fi Network or Parking Allocation"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="rule-value-textarea"
            className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
          >
            Ground Truth Value
          </label>
          <span className="text-[10px] bg-stone-100 text-slate-600 px-1.5 py-0.5 rounded font-code">
            Exact AI Context
          </span>
        </div>
        <textarea
          id="rule-value-textarea"
          rows={4}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Write the exact facts the co-host AI should rely on..."
          className="w-full bg-white border border-light-outline-variant rounded-md p-3 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold">
          Category Section
        </span>
        <SelectPopover
          id="rule-category-select"
          label="Rule category"
          value={category}
          options={CATEGORY_OPTIONS}
          onChange={setCategory}
        />
      </div>

      <div className="p-3 rounded-lg bg-light-surface-container-low border border-light-outline-variant flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <CalendarClock
              className="w-4 h-4 text-warning shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <span className="font-label text-label-md font-semibold text-light-on-surface block">
                Temporary / Seasonal Note
              </span>
              <span className="text-body-sm text-light-secondary block">
                Auto-excluded from AI replies after expiration date.
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isTemporary}
            aria-label="Temporary or seasonal note"
            onClick={() => setIsTemporary((prev) => !prev)}
            className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
              isTemporary ? 'bg-light-primary' : 'bg-stone-300'
            }`}
          >
            <span
              className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                isTemporary ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {isTemporary && (
          <div className="flex flex-col gap-1.5 pt-2 border-t border-light-outline-variant/70">
            <span className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold">
              Expiration Date
            </span>
            <DatePickerPopover
              id="rule-expiry-picker"
              label="Rule expiration date"
              value={expiresAt}
              onChange={setExpiresAt}
              placeholder="Choose expiration date"
            />
          </div>
        )}
      </div>

      {rule && (
        <div className="p-3 bg-light-surface-container-low rounded-lg border border-light-outline-variant/80 flex items-start gap-2.5">
          <ShieldCheck
            className="w-4 h-4 text-property-a shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="text-body-sm leading-snug">
            <span className="font-semibold text-light-on-surface block">Synced Origin</span>
            <span className="text-light-secondary">
              {rule.origin} · Updated {formatCalendarDate(rule.updatedAt)}
            </span>
          </div>
        </div>
      )}

      <div className="pt-2 flex flex-col gap-3">
        <div className="flex items-center gap-3">
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
            {rule ? 'Save Changes' : 'Add Rule'}
          </button>
        </div>

        {rule && onDelete && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="w-full min-h-[38px] text-center font-label text-label-md font-semibold text-rose-700 hover:text-rose-800 hover:underline flex items-center justify-center gap-1.5 transition"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span>Delete Rule</span>
          </button>
        )}
      </div>
    </form>
  );
}

export function RuleDetailsSheet({
  isOpen,
  rule,
  onClose,
  onSave,
  onDelete,
}: RuleDetailsSheetProps) {
  return (
    <BottomSheet
      isOpen={isOpen}
      title={rule ? 'Rule Details' : 'Add House Rule'}
      subtitle="Ground-truth facts used by the co-host AI"
      icon={<FileEdit className="w-5 h-5 text-property-a" aria-hidden="true" />}
      onClose={onClose}
    >
      {isOpen && (
        <RuleFormBody
          key={rule?.id ?? 'new-rule'}
          rule={rule}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </BottomSheet>
  );
}
