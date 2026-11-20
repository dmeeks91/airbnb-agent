export type GuestStage = 'inquiry' | 'confirmed' | 'current';

export type EmailClassification = 'guest_message' | 'host_reply_sync' | 'ignored_noise';

export interface ParsedEmailMessage {
  senderName: string;
  role: 'guest' | 'host';
  body: string;
}

export interface ParsedAirbnbEmail {
  gmailMessageId: string;
  rfcMessageId: string | null;
  fromAddress: string;
  fromName: string | null;
  replyToAddress: string | null;
  subject: string;
  sentAt: string;
  airbnbTemplate: string | null;
  classification: EmailClassification;
  needsHostReply: boolean;
  ignoreReason: string | null;
  guestName: string | null;
  guestCount: string | null;
  messages: ParsedEmailMessage[];
  bodyText: string;
  hasAttachmentsOnly: boolean;
  stage: GuestStage;
  stayDates: string | null;
  nights: number | null;
  airbnbThreadId: string | null;
  reservationCode: string | null;
  airbnbThreadUrl: string | null;
  allAirbnbUrls: string[];
  airbnbListingId: string | null;
  listingTitleHint: string | null;
}

export interface PropertyPricing {
  nightlyFloor: number;
  cleaningFee: number;
  localTaxPct: number;
  hostServiceFeePct: number;
}

export interface PropertyMatchCandidate {
  id: string;
  name: string;
  airbnbListingIds: string[];
  titleAliases: string[];
}

export interface ExistingThreadRef {
  threadId: string;
  propertyId: string;
  airbnbThreadId: string;
}

export type PropertyMatchResult =
  | {
      matched: true;
      propertyId: string;
      matchedBy: 'thread_id' | 'listing_id' | 'title_alias';
      existingThreadId?: string;
    }
  | {
      matched: false;
      reason: string;
    };

export type PayoutAssumption = 'all_in' | 'room_only';

export interface PayoutBreakdown {
  assumption: PayoutAssumption;
  guestQuote: number;
  nights: number;
  preTaxSubtotal: number;
  estimatedAccommodation: number;
  cleaningFee: number;
  estimatedTax: number;
  hostServiceFee: number;
  totalHostPayout: number;
  netAfterCleaning: number;
  estimatedNetPerNight: number;
  floorPerNight: number;
  belowFloor: boolean;
  deltaPerNight: number;
}

export interface DiscountAlert {
  offeredAmount: number;
  nights: number;
  defaultAssumption: PayoutAssumption;
  allIn: PayoutBreakdown;
  roomOnly: PayoutBreakdown;
  triggersWarning: boolean;
  matchedSnippet: string;
}

export type PropertyCode = 'A' | 'B' | 'C';

export interface PropertyVendor {
  id: string;
  name: string;
  role: string;
  phone: string;
  notes: string;
}

export type KnowledgeSourceType = 'paste_text' | 'pdf_upload' | 'quick_note';

export interface KnowledgeSource {
  id: string;
  title: string;
  type: KnowledgeSourceType;
  uploadedAt: string;
  ruleCount: number;
}

export interface Property {
  id: string;
  name: string;
  code: PropertyCode;
  accentColor: string;
  airbnbListingIds: string[];
  titleAliases: string[];
  signOffOverride: string | null;
  needsReplyCount: number;
  flaggedCount: number;
  pricing: PropertyPricing;
  vendors: PropertyVendor[];
  knowledgeSources: KnowledgeSource[];
}

export type RuleCategory = 'Access & Arrival' | 'Timings & Rates' | 'Amenities & Rules';

export interface HouseRule {
  id: string;
  propertyId: string;
  topic: string;
  value: string;
  category: RuleCategory;
  origin: string;
  isTemporary: boolean;
  expiresAt: string | null;
  updatedAt: string;
}

export type ThreadStatus = 'needs_reply' | 'flagged' | 'sent' | 'dismissed';

export interface CoachTurn {
  id: string;
  sender: 'agent' | 'host';
  text: string;
  note: string | null;
  draft: string | null;
  originalDraft?: string | null;
  editedByUser: boolean;
  createdAt: string;
}

export interface ActiveCoachSession {
  turns: CoachTurn[];
  hasNewGuestMessageSinceEdit: boolean;
}

export interface GuestThread {
  id: string;
  propertyId: string;
  guestName: string;
  guestCount: string | null;
  stayDates: string | null;
  nights: number | null;
  airbnbThreadId: string | null;
  reservationCode: string | null;
  airbnbThreadUrl: string | null;
  stage: GuestStage;
  status: ThreadStatus;
  unansweredCount: number;
  lastMessageAt: string;
  lastPreview: string;
  lastSentPreview: string | null;
  lastSentBy: string | null;
  discountAlert: DiscountAlert | null;
  activeCoachSession: ActiveCoachSession | null;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  propertyId: string;
  gmailMessageId: string | null;
  contentFingerprint: string;
  sender: 'guest' | 'host';
  senderName: string;
  body: string;
  sentAt: string;
  unanswered: boolean;
  loggedManually: boolean;
  archivedCoachNotes: string[];
}

export interface UnmatchedEmail {
  id: string;
  gmailMessageId: string;
  guestName: string;
  subject: string;
  bodyPreview: string;
  rawParsed: ParsedAirbnbEmail;
  receivedAt: string;
  resolved: boolean;
}

export type SignOffMode = 'collective' | 'individual' | 'none';

export interface LearnedVoiceDiff {
  id: string;
  originalDraft: string;
  finalSent: string;
  summary: string;
  createdAt: string;
}

export interface VoiceProfile {
  styleRules: string[];
  signOffMode: SignOffMode;
  signOffText: string;
  learnedDiffs: LearnedVoiceDiff[];
}

export type IngestionHealthStatus = 'healthy' | 'warning' | 'error';

export interface IngestionHealth {
  status: IngestionHealthStatus;
  lastPushAt: string | null;
  lastEmailReceivedAt: string | null;
  watchExpiresAt: string | null;
  lastError: string | null;
  watchedEmail: string;
  dualInboxActive: boolean;
}

export interface HostUserProfile {
  uid: string;
  email: string;
  displayName: string;
  fcmTokens: string[];
  pushEnabled: boolean;
  isAllowlisted: boolean;
  accessStatus?: 'checking' | 'allowed' | 'denied';
}

export interface ExtractedRuleCandidate {
  id: string;
  topic: string;
  value: string;
  category: RuleCategory;
  sourceLabel: string;
  conflictRuleId: string | null;
  existingValue: string | null;
}

export interface CoachTurnRequest {
  propertyId: string;
  threadId: string;
  instruction?: string;
  refreshBurst?: boolean;
}

export interface CoachTurnResponse {
  turn: CoachTurn;
  session: ActiveCoachSession;
  source: 'vertex' | 'local_fallback';
}

export interface MarkThreadSentRequest {
  propertyId: string;
  finalText: string;
  originalDraft?: string | null;
  senderName?: string;
  loggedManually?: boolean;
}

export interface DismissThreadRequest {
  propertyId: string;
}

export interface ExtractKnowledgeResponse {
  sourceTitle: string;
  sourceType: KnowledgeSourceType;
  candidates: ExtractedRuleCandidate[];
  source: 'vertex' | 'local_fallback';
}

export interface AssignUnmatchedRequest {
  propertyId: string;
}

export type CohostAppView =
  | 'messages'
  | 'dialogue'
  | 'thread'
  | 'house-details'
  | 'import'
  | 'account';

export interface CohostDataSnapshot {
  properties: Property[];
  rules: Record<string, HouseRule[]>;
  threads: Record<string, GuestThread[]>;
  messages: Record<string, ThreadMessage[]>;
  unmatchedEmails: UnmatchedEmail[];
  voiceProfile: VoiceProfile;
  ingestionHealth: IngestionHealth;
  userProfile: HostUserProfile;
  allowedEmails: string[];
}
