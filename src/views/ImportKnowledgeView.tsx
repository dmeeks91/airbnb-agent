import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Sparkles,
  StickyNote,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { ApiClientError, requestKnowledgeExtraction } from '../services/apiClient.ts';
import type {
  ExtractedRuleCandidate,
  HouseRule,
  KnowledgeSourceType,
  Property,
} from '../types/haven.ts';
import { extractRulesLocally } from '../utils/localKnowledgeExtractor.ts';
import { getPropertyDisplayLabel, getPropertyTheme } from '../utils/propertyHelpers.ts';

export interface ImportKnowledgeViewProps {
  property: Property;
  existingRules: readonly HouseRule[];
  useRemoteApi: boolean;
  onCancel: () => void;
  onMerge: (
    sourceTitle: string,
    sourceType: KnowledgeSourceType,
    selectedCandidates: readonly ExtractedRuleCandidate[],
  ) => Promise<void>;
}

const SOURCE_TABS: readonly {
  type: KnowledgeSourceType;
  label: string;
}[] = [
  { type: 'paste_text', label: 'Paste Text' },
  { type: 'pdf_upload', label: 'PDF Upload' },
  { type: 'quick_note', label: 'One-Liner' },
];

export function ImportKnowledgeView({
  property,
  existingRules,
  useRemoteApi,
  onCancel,
  onMerge,
}: ImportKnowledgeViewProps) {
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>('paste_text');
  const [sourceTitle, setSourceTitle] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<ExtractedRuleCandidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const theme = getPropertyTheme(property.code);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedPdf(file);
    if (file && !sourceTitle.trim()) {
      setSourceTitle(file.name);
    }
    setErrorMessage(null);
  };

  const handleExtract = async () => {
    setErrorMessage(null);
    const resolvedTitle =
      sourceTitle.trim() ||
      (sourceType === 'pdf_upload'
        ? selectedPdf?.name ?? 'Uploaded Guidebook.pdf'
        : sourceType === 'quick_note'
          ? 'Quick One-Liner Note'
          : 'Pasted Listing Notes');

    const textPayload = sourceType === 'quick_note' ? quickNote.trim() : pastedText.trim();

    if (sourceType === 'pdf_upload' && !selectedPdf) {
      setErrorMessage('Select a PDF guidebook or house manual first.');
      return;
    }
    if (sourceType !== 'pdf_upload' && !textPayload) {
      setErrorMessage('Enter listing text or a quick note to extract rules.');
      return;
    }

    setIsExtracting(true);
    try {
      let extracted: ExtractedRuleCandidate[] = [];

      if (useRemoteApi && typeof fetch === 'function') {
        try {
          const response = await requestKnowledgeExtraction({
            propertyId: property.id,
            sourceType,
            sourceTitle: resolvedTitle,
            textContent: textPayload,
            file: selectedPdf ?? undefined,
          });
          extracted = response.candidates;
        } catch (error) {
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
            setCandidates([]);
            setSelectedIds(new Set());
            setErrorMessage(error.message);
            return;
          }
          // Graceful local extraction fallback if server is temporarily unavailable
        }
      }

      if (extracted.length === 0) {
        if (sourceType === 'pdf_upload' && selectedPdf) {
          const fallbackText =
            typeof selectedPdf.text === 'function' ? await selectedPdf.text() : '';
          if (fallbackText.trimStart().startsWith('%PDF-')) {
            setCandidates([]);
            setSelectedIds(new Set());
            setErrorMessage(
              'Binary PDF extraction requires Vertex AI (Stage 5). Switch to Paste Text or upload a plain-text PDF fixture.',
            );
            return;
          }
          const cleaned = fallbackText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
          extracted =
            cleaned.length >= 6
              ? extractRulesLocally(cleaned, selectedPdf.name, existingRules)
              : [];
        } else {
          extracted = extractRulesLocally(textPayload, resolvedTitle, existingRules);
        }
      }

      setCandidates(extracted);
      setSelectedIds(new Set(extracted.map((c) => c.id)));
      if (extracted.length === 0) {
        setErrorMessage('No structured facts detected. Try adding clearer bullet lines.');
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const toggleCandidate = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === candidates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(candidates.map((c) => c.id)));
    }
  };

  const handleApproveAndMerge = async () => {
    const approved = candidates.filter((c) => selectedIds.has(c.id));
    if (approved.length === 0) {
      return;
    }
    const resolvedTitle =
      sourceTitle.trim() ||
      (sourceType === 'pdf_upload'
        ? selectedPdf?.name ?? 'Uploaded Guidebook.pdf'
        : sourceType === 'quick_note'
          ? 'Quick One-Liner Note'
          : 'Pasted Listing Notes');

    await onMerge(resolvedTitle, sourceType, approved);
  };

  return (
    <div className="flex flex-col flex-1 pb-24">
      <header className="px-4 py-3 border-b border-light-outline-variant bg-light-surface sticky top-0 z-20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel Import"
            className="w-9 h-9 rounded-full bg-light-surface-container-low border border-light-outline-variant flex items-center justify-center text-light-on-surface hover:bg-light-surface-container transition shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <h1 className="font-headline text-headline-sm text-light-on-surface leading-tight">
              Import House Details
            </h1>
            <div className="flex items-center gap-1.5 text-body-sm truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${theme.dotBg}`}
                aria-hidden="true"
              />
              <span className={`font-label text-label-sm font-semibold truncate ${theme.text}`}>
                {getPropertyDisplayLabel(property)}
              </span>
            </div>
          </div>
        </div>

        <span className="text-[11px] font-code text-property-a bg-teal-50 px-2 py-0.5 rounded border border-teal-200 shrink-0">
          AI Extraction
        </span>
      </header>

      <main className="px-4 py-3 flex flex-col gap-4 flex-1">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-label-sm">
            <span className="font-label font-semibold text-light-on-surface">
              Choose Knowledge Source
            </span>
            <span className="text-light-secondary">Review conflicts before saving</span>
          </div>

          <div
            role="tablist"
            aria-label="Knowledge import method"
            className="grid grid-cols-3 p-1 bg-light-surface-container rounded-lg gap-1"
          >
            {SOURCE_TABS.map((tab) => {
              const isSelected = sourceType === tab.type;
              return (
                <button
                  key={tab.type}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => {
                    setSourceType(tab.type);
                    setErrorMessage(null);
                  }}
                  className={`min-h-[42px] py-2 px-2 rounded-md font-label text-label-sm flex flex-col items-center justify-center gap-1 transition ${
                    isSelected
                      ? 'bg-white text-light-on-surface font-semibold'
                      : 'text-light-secondary hover:text-light-on-surface'
                  }`}
                >
                  {tab.type === 'paste_text' && (
                    <StickyNote className="w-4 h-4" aria-hidden="true" />
                  )}
                  {tab.type === 'pdf_upload' && (
                    <FileText className="w-4 h-4" aria-hidden="true" />
                  )}
                  {tab.type === 'quick_note' && <Zap className="w-4 h-4" aria-hidden="true" />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-white rounded-lg border border-light-outline-variant p-3.5 flex flex-col gap-3">
          {sourceType === 'paste_text' && (
            <>
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm font-semibold text-light-secondary uppercase tracking-wider">
                  Source Label (Optional)
                </span>
                <input
                  type="text"
                  value={sourceTitle}
                  onChange={(event) => setSourceTitle(event.target.value)}
                  placeholder="e.g. Airbnb Listing House Manual"
                  className="min-h-[40px] px-3 py-2 bg-white border border-light-outline-variant rounded-md text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm font-semibold text-light-secondary uppercase tracking-wider">
                  Listing Text or Host Notes
                </span>
                <textarea
                  rows={5}
                  value={pastedText}
                  onChange={(event) => setPastedText(event.target.value)}
                  placeholder="Paste check-in instructions, parking rules, pet policies, trash schedule..."
                  className="w-full p-3 bg-white border border-light-outline-variant rounded-md text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
                />
              </label>
            </>
          )}

          {sourceType === 'pdf_upload' && (
            <div className="flex flex-col gap-3">
              <label
                htmlFor="pdf-guidebook-input"
                className="border-2 border-dashed border-light-outline-variant rounded-lg p-5 flex flex-col items-center justify-center gap-2 bg-stone-50 hover:bg-stone-100 transition cursor-pointer text-center"
              >
                <input
                  id="pdf-guidebook-input"
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileChange}
                  className="sr-only"
                />
                <span className="w-10 h-10 rounded-full bg-white border border-light-outline-variant flex items-center justify-center text-property-a">
                  <Upload className="w-5 h-5" aria-hidden="true" />
                </span>
                <div>
                  <span className="font-label text-label-md font-semibold text-light-on-surface block">
                    Upload PDF Welcome Guide or Manual
                  </span>
                  <span className="text-body-sm text-light-secondary">
                    PDF only (parsed natively via Gemini multimodal)
                  </span>
                </div>
              </label>

              {selectedPdf && (
                <div className="p-2.5 bg-success-surface rounded-md border border-green-200 flex items-center justify-between text-body-sm text-success">
                  <span className="font-label font-semibold truncate">{selectedPdf.name}</span>
                  <span className="font-code text-[11px] shrink-0">Ready</span>
                </div>
              )}
            </div>
          )}

          {sourceType === 'quick_note' && (
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm font-semibold text-light-secondary uppercase tracking-wider">
                Quick One-Liner Fact
              </span>
              <input
                type="text"
                value={quickNote}
                onChange={(event) => setQuickNote(event.target.value)}
                placeholder="e.g. Trash pickup moved to Wednesday mornings at 7 AM"
                className="min-h-[42px] px-3 py-2 bg-white border border-light-outline-variant rounded-md text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary"
              />
            </label>
          )}

          {errorMessage && (
            <p role="alert" className="text-body-sm text-warning font-medium">
              {errorMessage}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleExtract()}
            disabled={isExtracting}
            className="w-full min-h-[42px] px-4 py-2 rounded-md bg-light-primary text-white font-label text-label-md font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:opacity-95 transition"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            <span>{isExtracting ? 'Extracting Facts...' : 'Extract Rules'}</span>
          </button>
        </section>

        {candidates.length > 0 && (
          <section className="flex flex-col gap-2.5" aria-label="Extracted rules review">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-headline text-headline-sm text-light-on-surface">
                  Parsed Rules to Merge
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-teal-50 text-property-a border border-teal-200 text-[11px] font-code font-semibold">
                  {candidates.length} detected
                </span>
              </div>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="text-label-sm font-semibold text-property-a hover:underline"
              >
                {selectedIds.size === candidates.length ? 'Clear All' : 'Select All'}
              </button>
            </div>

            <div className="bg-white rounded-lg border border-light-outline-variant divide-y divide-light-outline-variant max-h-[42vh] overflow-y-auto overscroll-contain">
              {candidates.map((candidate) => {
                const isChecked = selectedIds.has(candidate.id);
                const isConflict = Boolean(candidate.conflictRuleId);

                return (
                  <label
                    key={candidate.id}
                    className="p-3 flex items-start gap-3 cursor-pointer hover:bg-stone-50 transition"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCandidate(candidate.id)}
                      className="mt-1 w-4 h-4 rounded border-light-outline-variant accent-light-primary shrink-0"
                    />
                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-label text-label-md font-semibold text-light-on-surface">
                          {candidate.topic}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-code font-semibold flex items-center gap-1 ${
                            isConflict
                              ? 'bg-warning-surface text-warning border border-amber-300'
                              : 'bg-teal-50 text-property-a border border-teal-200'
                          }`}
                        >
                          {isConflict && (
                            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                          )}
                          <span>{isConflict ? 'Updates existing rule' : 'New rule'}</span>
                        </span>
                      </div>

                      <p className="text-body-sm text-light-on-surface">{candidate.value}</p>

                      {isConflict && candidate.existingValue && (
                        <div className="mt-1 p-2 rounded bg-stone-50 border border-light-outline-variant/80 text-[11px] text-light-secondary">
                          <span className="font-semibold text-slate-700">Current rule:</span>{' '}
                          {candidate.existingValue}
                        </div>
                      )}

                      <span className="text-[11px] font-code text-light-outline">
                        {candidate.category}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 max-w-[420px] mx-auto bg-white/95 backdrop-blur-sm border-t border-light-outline-variant p-3 flex items-center gap-3 z-30">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[42px] px-4 py-2 rounded-md border border-light-outline-variant bg-white text-light-secondary hover:text-light-on-surface font-label text-label-md font-semibold transition"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={selectedIds.size === 0}
          onClick={() => void handleApproveAndMerge()}
          className="flex-1 min-h-[42px] px-4 py-2 rounded-md bg-light-primary text-white font-label text-label-md font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5 hover:opacity-95 transition"
        >
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          <span>
            Approve &amp; Merge ({selectedIds.size})
          </span>
        </button>
      </div>
    </div>
  );
}
