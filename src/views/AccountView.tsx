import {
  Activity,
  Bell,
  Check,
  LogOut,
  MailCheck,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { SelectPopover, type SelectOption } from '../components/ui/SelectPopover.tsx';
import type {
  HostUserProfile,
  IngestionHealth,
  SignOffMode,
  VoiceProfile,
} from '../types/cohost.ts';
import { formatCalendarDate, formatRelativeTime } from '../utils/dateFormat.ts';

export interface AccountViewProps {
  userProfile: HostUserProfile;
  allowedEmails: readonly string[];
  ingestionHealth: IngestionHealth;
  voiceProfile: VoiceProfile;
  isLiveFirebase: boolean;
  pushStatusMessage: string | null;
  isUpdatingPush: boolean;
  onTogglePush: (nextEnabled: boolean) => Promise<void>;
  onUpdateVoiceProfile: (
    updates: Partial<Pick<VoiceProfile, 'styleRules' | 'signOffMode' | 'signOffText'>>,
  ) => Promise<void>;
  onDeleteLearnedDiff: (diffId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

const SIGNOFF_MODE_OPTIONS: readonly SelectOption<SignOffMode>[] = [
  {
    value: 'collective',
    label: 'Collective Sign-Off',
    description: 'Sign jointly (e.g. Best, Alex & Jordan)',
  },
  {
    value: 'individual',
    label: 'Individual Sign-Off',
    description: 'Sign with your own name',
  },
  {
    value: 'none',
    label: 'No Sign-Off',
    description: 'End directly after the answer',
  },
];

export function AccountView({
  userProfile,
  allowedEmails,
  ingestionHealth,
  voiceProfile,
  isLiveFirebase,
  pushStatusMessage,
  isUpdatingPush,
  onTogglePush,
  onUpdateVoiceProfile,
  onDeleteLearnedDiff,
  onSignOut,
}: AccountViewProps) {
  const [draftSignOffMode, setDraftSignOffMode] = useState<SignOffMode | null>(null);
  const [draftSignOffText, setDraftSignOffText] = useState<string | null>(null);
  const [newStyleRule, setNewStyleRule] = useState('');
  const [savedVoiceNotice, setSavedVoiceNotice] = useState(false);

  const signOffMode = draftSignOffMode ?? voiceProfile.signOffMode;
  const signOffText = draftSignOffText ?? voiceProfile.signOffText;

  const initials = (userProfile.displayName.trim()[0] ?? 'H').toUpperCase();

  const handleSaveVoice = async (event: FormEvent) => {
    event.preventDefault();
    await onUpdateVoiceProfile({
      signOffMode,
      signOffText: signOffText.trim(),
    });
    setDraftSignOffMode(null);
    setDraftSignOffText(null);
    setSavedVoiceNotice(true);
    setTimeout(() => setSavedVoiceNotice(false), 2000);
  };

  const handleAddStyleRule = async () => {
    const trimmed = newStyleRule.trim();
    if (!trimmed) {
      return;
    }
    await onUpdateVoiceProfile({
      styleRules: [...voiceProfile.styleRules, trimmed],
    });
    setNewStyleRule('');
  };

  const handleRemoveStyleRule = async (indexToRemove: number) => {
    await onUpdateVoiceProfile({
      styleRules: voiceProfile.styleRules.filter((_, idx) => idx !== indexToRemove),
    });
  };

  return (
    <div className="flex flex-col flex-1 pb-24">
      <header className="px-4 py-3 border-b border-light-outline-variant bg-light-surface sticky top-0 z-20 flex items-center justify-between gap-2">
        <div>
          <h1 className="font-headline text-headline-sm text-light-on-surface leading-tight">
            Host Account &amp; Preferences
          </h1>
          <p className="text-body-sm text-light-secondary font-label">
            Access, Push Alerts, Gmail Sync &amp; Voice Memory
          </p>
        </div>

        <span className="text-body-sm text-success font-label font-semibold flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-success" aria-hidden="true" />
          <span>Synced</span>
        </span>
      </header>

      <main className="px-4 py-3.5 flex flex-col gap-4 flex-1">
        <section className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-light-primary text-white flex items-center justify-center font-headline text-[16px] shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-label text-label-lg font-semibold text-light-on-surface">
                    {userProfile.displayName}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-code font-semibold bg-success-surface text-success border border-green-200 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                    <span>{isLiveFirebase ? 'Verified Allowlist' : 'Local Dev Host'}</span>
                  </span>
                </div>
                <p className="text-body-sm text-light-secondary truncate">{userProfile.email}</p>
              </div>
            </div>

            {isLiveFirebase && (
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="min-h-[36px] px-2.5 py-1.5 rounded-md border border-light-outline-variant text-light-secondary hover:text-light-on-surface text-label-sm font-semibold flex items-center gap-1 shrink-0 transition"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            )}
          </div>

          <div className="pt-2 border-t border-light-outline-variant/60 text-body-sm text-light-secondary">
            <span className="font-semibold text-light-on-surface">Allowed Host Emails:</span>{' '}
            <span className="font-code text-[11px]">{allowedEmails.join(', ')}</span>
          </div>
        </section>

        <section className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Bell className="w-5 h-5 text-light-primary shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="font-label text-label-md font-semibold text-light-on-surface">
                  Android Push Alerts
                </h2>
                <p className="text-body-sm text-light-secondary">
                  Instant tap-to-draft alerts when new Airbnb guest emails arrive.
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={userProfile.pushEnabled}
              aria-label="Enable Android Push Alerts"
              disabled={isUpdatingPush}
              onClick={() => void onTogglePush(!userProfile.pushEnabled)}
              className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                userProfile.pushEnabled ? 'bg-light-primary' : 'bg-stone-300'
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                  userProfile.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {pushStatusMessage && (
            <p className="text-body-sm text-light-secondary bg-stone-50 border border-light-outline-variant/70 rounded-md px-2.5 py-1.5">
              {pushStatusMessage}
            </p>
          )}
        </section>

        <section
          aria-label="Gmail Watch and Sync Health"
          className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MailCheck className="w-4 h-4 text-property-a" aria-hidden="true" />
              <h2 className="font-label text-label-md font-semibold text-light-on-surface">
                Gmail Watch &amp; Sync Health
              </h2>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-code font-semibold ${
                ingestionHealth.status === 'healthy'
                  ? 'bg-success-surface text-success'
                  : 'bg-warning-surface text-warning'
              }`}
            >
              {ingestionHealth.status === 'healthy' ? 'Healthy' : 'Attention Needed'}
            </span>
          </div>

          <div className="text-body-sm text-light-secondary flex flex-col gap-1.5 bg-light-surface-container-low rounded-md p-2.5 border border-light-outline-variant/70">
            <div className="flex items-center justify-between gap-2">
              <span>Workspace Alias</span>
              <span className="font-code text-[11px] text-light-on-surface truncate">
                {ingestionHealth.watchedEmail}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Dual-Inbox Forwarding</span>
              <span className="font-code text-[11px] text-success font-semibold">
                {ingestionHealth.dualInboxActive ? 'Host + Co-Host Active' : 'Single Inbox'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Last Push Event</span>
              <span className="font-code text-[11px] text-light-on-surface">
                {ingestionHealth.lastPushAt
                  ? formatRelativeTime(ingestionHealth.lastPushAt)
                  : 'Pending'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>7-Day Watch Expires</span>
              <span className="font-code text-[11px] text-light-on-surface">
                {ingestionHealth.watchExpiresAt
                  ? formatCalendarDate(ingestionHealth.watchExpiresAt)
                  : 'Not scheduled'}
              </span>
            </div>
          </div>

          {ingestionHealth.lastError && (
            <p className="text-body-sm text-warning font-medium flex items-center gap-1.5">
              <Activity className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{ingestionHealth.lastError}</span>
            </p>
          )}
        </section>

        <section className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-3">
          <div>
            <h2 className="font-label text-label-md font-semibold text-light-on-surface">
              Sign-Off &amp; Style Guardrails
            </h2>
            <p className="text-body-sm text-light-secondary">
              Applied to every property unless a per-property sign-off override is set.
            </p>
          </div>

          <form onSubmit={(event) => void handleSaveVoice(event)} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold">
                Sign-Off Mode
              </span>
              <SelectPopover
                id="signoff-mode-select"
                label="Sign-off mode"
                value={signOffMode}
                options={SIGNOFF_MODE_OPTIONS}
                onChange={setDraftSignOffMode}
              />
            </div>

            {signOffMode !== 'none' && (
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold">
                  Default Sign-Off Text
                </span>
                <input
                  type="text"
                  value={signOffText}
                  onChange={(event) => setDraftSignOffText(event.target.value)}
                  placeholder="Best, Alex & Jordan"
                  className="min-h-[40px] px-3 py-2 bg-white border border-light-outline-variant rounded-md text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
                />
              </label>
            )}

            <button
              type="submit"
              className="w-full min-h-[40px] px-4 py-2 rounded-md bg-light-primary text-white font-label text-label-md font-semibold flex items-center justify-center gap-1.5 hover:opacity-95 transition"
            >
              {savedVoiceNotice ? (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" />
                  <span>Voice Settings Saved</span>
                </>
              ) : (
                <span>Save Voice Settings</span>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-light-outline-variant/60 flex flex-col gap-2">
            <span className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold">
              Active Style Rules ({voiceProfile.styleRules.length})
            </span>
            <ul className="flex flex-col gap-1.5">
              {voiceProfile.styleRules.map((ruleText, idx) => (
                <li
                  key={`${ruleText}-${idx}`}
                  className="p-2 rounded-md bg-light-surface-container-low border border-light-outline-variant/70 text-body-sm text-light-on-surface flex items-center justify-between gap-2"
                >
                  <span>{ruleText}</span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveStyleRule(idx)}
                    aria-label={`Remove style rule ${idx + 1}`}
                    className="p-1 text-light-outline hover:text-rose-700 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newStyleRule}
                onChange={(event) => setNewStyleRule(event.target.value)}
                placeholder="Add style rule (e.g. Mention parking early)..."
                aria-label="New style rule"
                className="flex-1 min-h-[38px] px-3 py-1.5 bg-white border border-light-outline-variant rounded-md text-body-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
              />
              <button
                type="button"
                onClick={() => void handleAddStyleRule()}
                disabled={newStyleRule.trim().length === 0}
                className="min-h-[38px] px-3 rounded-md border border-light-outline-variant bg-white text-light-on-surface font-label text-label-sm font-semibold disabled:opacity-40 hover:bg-stone-50 flex items-center gap-1 transition"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Add</span>
              </button>
            </div>
          </div>
        </section>

        <section
          aria-label="Learned voice diffs"
          className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-label text-label-md font-semibold text-light-on-surface">
                Learned Voice Diffs
              </h2>
              <p className="text-body-sm text-light-secondary">
                Rolling window of your real edits used to calibrate drafts.
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-light-primary-container text-light-on-primary-container font-code text-[11px] font-semibold shrink-0">
              {voiceProfile.learnedDiffs.length} / 15
            </span>
          </div>

          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto overscroll-contain">
            {voiceProfile.learnedDiffs.length === 0 && (
              <p className="text-body-sm text-light-secondary py-2">
                No learned edits stored yet. Whenever you edit an AI draft before marking it sent, it appears here.
              </p>
            )}

            {voiceProfile.learnedDiffs.map((diff) => (
              <div
                key={diff.id}
                className="p-3 rounded-lg bg-light-surface-container-low border border-light-outline-variant/80 flex flex-col gap-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-label text-label-sm font-semibold text-light-on-surface">
                      {diff.summary}
                    </p>
                    <span className="text-[11px] font-code text-light-outline">
                      {formatCalendarDate(diff.createdAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDeleteLearnedDiff(diff.id)}
                    aria-label={`Delete learned diff: ${diff.summary}`}
                    className="p-1.5 rounded-md text-light-outline hover:text-rose-700 hover:bg-white transition shrink-0"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="text-[12px] text-light-secondary line-through opacity-75">
                  {diff.originalDraft}
                </div>
                <div className="text-[12px] text-slate-900 font-medium">
                  {diff.finalSent}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
