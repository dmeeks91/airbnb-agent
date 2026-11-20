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
