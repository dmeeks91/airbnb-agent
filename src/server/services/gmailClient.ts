import { OAuth2Client } from 'google-auth-library';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailHistorySyncResult {
  messageIds: string[];
  latestHistoryId: string | null;
  usedFallbackList: boolean;
}

export interface GmailWatchResult {
  historyId: string;
  watchExpiresAt: string;
}

export interface GmailSyncClient {
  resolveLabelId(labelName: string): Promise<string | null>;
  listHistoryMessageIds(
    startHistoryId: string | null,
    labelId: string,
  ): Promise<GmailHistorySyncResult>;
  fetchRawMessage(gmailMessageId: string): Promise<Buffer>;
  renewWatch(topicName: string, labelId: string): Promise<GmailWatchResult>;
  getProfileHistoryId(): Promise<string | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isGmailOAuthConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_OAUTH_CLIENT_ID?.trim() &&
      process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim(),
  );
}

export class WorkspaceGmailClient implements GmailSyncClient {
  private readonly oauthClient: OAuth2Client;

  constructor() {
    this.oauthClient = new OAuth2Client(
      process.env.GMAIL_OAUTH_CLIENT_ID?.trim(),
      process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim(),
    );
    this.oauthClient.setCredentials({
      refresh_token: process.env.GMAIL_OAUTH_REFRESH_TOKEN?.trim(),
    });
  }

  private async getAccessToken(): Promise<string> {
    const tokenResponse = await this.oauthClient.getAccessToken();
    const token = tokenResponse.token;
    if (!token) {
      throw new Error('Unable to acquire Workspace Gmail OAuth access token');
    }
    return token;
  }

  private async gmailFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(`${GMAIL_API_BASE}${path}`, {
      ...init,
      headers,
    });
  }

  public async getProfileHistoryId(): Promise<string | null> {
    const response = await this.gmailFetch('/profile');
    if (!response.ok) {
      return null;
    }
    const data: unknown = await response.json();
    if (!isRecord(data)) {
      return null;
    }
    if (typeof data.historyId === 'string') {
      return data.historyId;
    }
    if (typeof data.historyId === 'number') {
      return String(data.historyId);
    }
    return null;
  }

  public async resolveLabelId(labelName: string): Promise<string | null> {
    const response = await this.gmailFetch('/labels');
    if (!response.ok) {
      throw new Error(`Gmail labels lookup failed (${response.status})`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.labels)) {
      return null;
    }
    const lowerTarget = labelName.trim().toLowerCase();
    for (const label of data.labels) {
      if (
        isRecord(label) &&
        typeof label.name === 'string' &&
        typeof label.id === 'string' &&
        label.name.trim().toLowerCase() === lowerTarget
      ) {
        return label.id;
      }
    }
    return null;
  }

  /**
   * Lists new Gmail message IDs since `startHistoryId` scoped to `labelId`,
   * following pagination via `nextPageToken`.
   * Handles Gmail 404 (expired history cursor) gracefully by falling back to a recent
   * label-filtered messages.list query (oldest first) and refreshing the mailbox historyId.
   */
  public async listHistoryMessageIds(
    startHistoryId: string | null,
    labelId: string,
  ): Promise<GmailHistorySyncResult> {
    if (!startHistoryId) {
      return this.listRecentLabelMessages(labelId);
    }

    const messageIds = new Set<string>();
    let latestHistoryId: string | null = null;
    let pageToken: string | undefined;

    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        startHistoryId,
        labelId,
      });
      params.append('historyTypes', 'messageAdded');
      params.append('historyTypes', 'labelAdded');
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const response = await this.gmailFetch(`/history?${params.toString()}`);

      if (response.status === 404) {
        return this.listRecentLabelMessages(labelId);
      }
      if (!response.ok) {
        throw new Error(`Gmail history sync failed (${response.status})`);
      }

      const data: unknown = await response.json();
      if (!isRecord(data)) {
        break;
      }

      if (typeof data.historyId === 'string') {
        latestHistoryId = data.historyId;
      } else if (typeof data.historyId === 'number') {
        latestHistoryId = String(data.historyId);
      }

      if (Array.isArray(data.history)) {
        for (const entry of data.history) {
          if (!isRecord(entry)) {
            continue;
          }
          if (Array.isArray(entry.messagesAdded)) {
            for (const added of entry.messagesAdded) {
              if (
                isRecord(added) &&
                isRecord(added.message) &&
                typeof added.message.id === 'string'
              ) {
                messageIds.add(added.message.id);
              }
            }
          }
          if (Array.isArray(entry.labelsAdded)) {
            for (const labeled of entry.labelsAdded) {
              if (
                isRecord(labeled) &&
                isRecord(labeled.message) &&
                typeof labeled.message.id === 'string'
              ) {
                messageIds.add(labeled.message.id);
              }
            }
          }
        }
      }

      if (typeof data.nextPageToken === 'string' && data.nextPageToken.trim()) {
        pageToken = data.nextPageToken.trim();
      } else {
        break;
      }
    }

    return {
      messageIds: Array.from(messageIds),
      latestHistoryId,
      usedFallbackList: false,
    };
  }

  private async listRecentLabelMessages(labelId: string): Promise<GmailHistorySyncResult> {
    const params = new URLSearchParams({
      labelIds: labelId,
      maxResults: '15',
    });
    const response = await this.gmailFetch(`/messages?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Gmail fallback list failed (${response.status})`);
    }
    const data: unknown = await response.json();
    const messageIds: string[] = [];
    if (isRecord(data) && Array.isArray(data.messages)) {
      for (const msg of data.messages) {
        if (isRecord(msg) && typeof msg.id === 'string') {
          messageIds.push(msg.id);
        }
      }
    }
    // Gmail messages.list returns newest-first; reverse so older messages ingest before newer host replies
    messageIds.reverse();

    const profileHistoryId = await this.getProfileHistoryId();

    return {
      messageIds,
      latestHistoryId: profileHistoryId,
      usedFallbackList: true,
    };
  }

  public async fetchRawMessage(gmailMessageId: string): Promise<Buffer> {
    const response = await this.gmailFetch(
      `/messages/${encodeURIComponent(gmailMessageId)}?format=raw`,
    );
    if (!response.ok) {
      throw new Error(`Gmail message fetch failed (${response.status})`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data.raw !== 'string') {
      throw new Error('Gmail API returned no raw MIME payload');
    }
    return Buffer.from(data.raw, 'base64url');
  }

  public async renewWatch(topicName: string, labelId: string): Promise<GmailWatchResult> {
    const response = await this.gmailFetch('/watch', {
      method: 'POST',
      body: JSON.stringify({
        topicName,
        labelIds: [labelId],
        labelFilterBehavior: 'INCLUDE',
      }),
    });
    if (!response.ok) {
      throw new Error(`Gmail watch renewal failed (${response.status})`);
    }
    const data: unknown = await response.json();
    if (!isRecord(data) || (typeof data.historyId !== 'string' && typeof data.historyId !== 'number')) {
      throw new Error('Gmail watch response missing historyId');
    }
    const expirationMs =
      typeof data.expiration === 'string'
        ? Number.parseInt(data.expiration, 10)
        : typeof data.expiration === 'number'
          ? data.expiration
          : Date.now() + 7 * 24 * 60 * 60 * 1000;

    return {
      historyId: String(data.historyId),
      watchExpiresAt: new Date(expirationMs).toISOString(),
    };
  }
}
