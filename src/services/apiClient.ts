import type {
  ActiveCoachSession,
  AssignUnmatchedRequest,
  CoachTurn,
  CoachTurnRequest,
  CoachTurnResponse,
  DismissThreadRequest,
  ExtractedRuleCandidate,
  ExtractKnowledgeResponse,
  KnowledgeSourceType,
  MarkThreadSentRequest,
  RuleCategory,
} from '../types/cohost.ts';
import { getCurrentIdToken } from './firebase.ts';

export class ApiClientError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRuleCategory(value: unknown): RuleCategory {
  if (
    value === 'Access & Arrival' ||
    value === 'Timings & Rates' ||
    value === 'Amenities & Rules'
  ) {
    return value;
  }
  return 'Amenities & Rules';
}

function parseCoachTurn(value: unknown): CoachTurn {
  if (!isRecord(value)) {
    throw new ApiClientError('Malformed coach turn payload', 500);
  }
  const draft = typeof value.draft === 'string' ? value.draft : null;
  return {
    id: typeof value.id === 'string' ? value.id : `turn-${Date.now()}`,
    sender: value.sender === 'host' ? 'host' : 'agent',
    text: typeof value.text === 'string' ? value.text : '',
    note: typeof value.note === 'string' ? value.note : null,
    draft,
    originalDraft:
      typeof value.originalDraft === 'string' ? value.originalDraft : draft,
    editedByUser: Boolean(value.editedByUser),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
  };
}

function parseCoachTurnResponse(raw: unknown): CoachTurnResponse {
  if (!isRecord(raw) || !isRecord(raw.session) || !Array.isArray(raw.session.turns)) {
    throw new ApiClientError('Malformed coach response payload', 500);
  }
  const session: ActiveCoachSession = {
    turns: raw.session.turns.map(parseCoachTurn),
    hasNewGuestMessageSinceEdit: Boolean(raw.session.hasNewGuestMessageSinceEdit),
  };
  return {
    turn: parseCoachTurn(raw.turn),
    session,
    source: raw.source === 'vertex' ? 'vertex' : 'local_fallback',
  };
}

function parseExtractKnowledgeResponse(raw: unknown): ExtractKnowledgeResponse {
  if (!isRecord(raw) || !Array.isArray(raw.candidates)) {
    throw new ApiClientError('Malformed knowledge extraction response', 500);
  }
  const sourceType: KnowledgeSourceType =
    raw.sourceType === 'pdf_upload' ||
    raw.sourceType === 'quick_note' ||
    raw.sourceType === 'url_import'
      ? raw.sourceType
      : 'paste_text';

  const candidates: ExtractedRuleCandidate[] = [];
  for (const item of raw.candidates) {
    if (!isRecord(item)) {
      continue;
    }
    candidates.push({
      id: typeof item.id === 'string' ? item.id : `cand-${candidates.length + 1}`,
      topic: typeof item.topic === 'string' ? item.topic : '',
      value: typeof item.value === 'string' ? item.value : '',
      category: parseRuleCategory(item.category),
      sourceLabel: typeof item.sourceLabel === 'string' ? item.sourceLabel : 'Extracted note',
      conflictRuleId: typeof item.conflictRuleId === 'string' ? item.conflictRuleId : null,
      existingValue: typeof item.existingValue === 'string' ? item.existingValue : null,
    });
  }

  return {
    sourceTitle: typeof raw.sourceTitle === 'string' ? raw.sourceTitle : 'Imported notes',
    sourceType,
    candidates,
    source: raw.source === 'vertex' ? 'vertex' : 'local_fallback',
  };
}

async function buildAuthHeaders(extraHeaders?: Record<string, string>): Promise<Headers> {
  const headers = new Headers(extraHeaders);
  const token = await getCurrentIdToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === 'string') {
      return body.error;
    }
  } catch {
    // ignore non-JSON error bodies
  }
  return `Request failed with status ${response.status}`;
}

async function postJson<TRequest, TResponse>(
  path: string,
  payload: TRequest,
  decoder: (raw: unknown) => TResponse,
): Promise<TResponse> {
  const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new ApiClientError(await parseErrorMessage(response), response.status);
  }

  const raw: unknown = await response.json();
  return decoder(raw);
}

export async function requestCoachTurn(
  payload: CoachTurnRequest,
): Promise<CoachTurnResponse> {
  return postJson('/api/coach/turn', payload, parseCoachTurnResponse);
}

export async function notifyThreadSent(
  threadId: string,
  payload: MarkThreadSentRequest,
): Promise<{ ok: true }> {
  return postJson(
    `/api/threads/${encodeURIComponent(threadId)}/sent`,
    payload,
    () => ({ ok: true as const }),
  );
}

async function deleteJson(path: string): Promise<{ ok: true }> {
  const headers = await buildAuthHeaders();
  const response = await fetch(path, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok) {
    throw new ApiClientError(await parseErrorMessage(response), response.status);
  }

  return { ok: true };
}

export async function notifyThreadDismissed(
  threadId: string,
  payload: DismissThreadRequest,
): Promise<{ ok: true }> {
  return postJson(
    `/api/threads/${encodeURIComponent(threadId)}/dismiss`,
    payload,
    () => ({ ok: true as const }),
  );
}

export async function requestDeleteThread(
  propertyId: string,
  threadId: string,
): Promise<{ ok: true }> {
  return deleteJson(
    `/api/threads/${encodeURIComponent(threadId)}?propertyId=${encodeURIComponent(propertyId)}`,
  );
}

export async function requestKnowledgeExtraction(params: {
  propertyId: string;
  sourceType: KnowledgeSourceType;
  sourceTitle: string;
  textContent?: string;
  sourceUrl?: string;
  file?: File;
}): Promise<ExtractKnowledgeResponse> {
  if (params.sourceType === 'pdf_upload' && params.file) {
    const formData = new FormData();
    formData.append('propertyId', params.propertyId);
    formData.append('sourceType', params.sourceType);
    formData.append('sourceTitle', params.sourceTitle);
    formData.append('file', params.file);

    const headers = await buildAuthHeaders();
    const response = await fetch('/api/knowledge/extract', {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      throw new ApiClientError(await parseErrorMessage(response), response.status);
    }
    const raw: unknown = await response.json();
    return parseExtractKnowledgeResponse(raw);
  }

  return postJson(
    '/api/knowledge/extract',
    {
      propertyId: params.propertyId,
      sourceType: params.sourceType,
      sourceTitle: params.sourceTitle,
      textContent: params.textContent ?? '',
      sourceUrl: params.sourceUrl ?? '',
    },
    parseExtractKnowledgeResponse,
  );
}

export async function requestAssignUnmatched(
  unmatchedId: string,
  payload: AssignUnmatchedRequest,
): Promise<{ ok: true; threadId: string }> {
  return postJson(
    `/api/unmatched/${encodeURIComponent(unmatchedId)}/assign`,
    payload,
    (raw) => {
      if (isRecord(raw) && typeof raw.threadId === 'string') {
        return { ok: true as const, threadId: raw.threadId };
      }
      throw new ApiClientError('Malformed unmatched assignment response', 500);
    },
  );
}

export async function requestDeleteUnmatched(unmatchedId: string): Promise<{ ok: true }> {
  return deleteJson(`/api/unmatched/${encodeURIComponent(unmatchedId)}`);
}
