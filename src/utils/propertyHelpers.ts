import type { Property, PropertyCode } from '../types/cohost.ts';

export interface PropertyThemeClasses {
  dotBg: string;
  text: string;
  softBg: string;
  softBorder: string;
  badgeBg: string;
  accentBar: string;
  cardBorder: string;
  ring: string;
  bubbleBg: string;
  bubbleBorder: string;
  bubbleText: string;
}

const PROPERTY_THEMES: Record<PropertyCode, PropertyThemeClasses> = {
  A: {
    dotBg: 'bg-property-a',
    text: 'text-property-a',
    softBg: 'bg-teal-50',
    softBorder: 'border-teal-200',
    badgeBg: 'bg-teal-100 text-property-a',
    accentBar: 'bg-property-a',
    cardBorder: 'border-property-a/60 hover:border-property-a',
    ring: 'ring-property-a/20',
    bubbleBg: 'bg-teal-50',
    bubbleBorder: 'border-teal-200',
    bubbleText: 'text-teal-950',
  },
  B: {
    dotBg: 'bg-property-b',
    text: 'text-property-b',
    softBg: 'bg-amber-50',
    softBorder: 'border-amber-200',
    badgeBg: 'bg-amber-100 text-property-b',
    accentBar: 'bg-property-b',
    cardBorder: 'border-property-b/60 hover:border-property-b',
    ring: 'ring-property-b/20',
    bubbleBg: 'bg-amber-50',
    bubbleBorder: 'border-amber-200',
    bubbleText: 'text-amber-950',
  },
  C: {
    dotBg: 'bg-property-c',
    text: 'text-property-c',
    softBg: 'bg-rose-50',
    softBorder: 'border-rose-200',
    badgeBg: 'bg-rose-100 text-property-c',
    accentBar: 'bg-property-c',
    cardBorder: 'border-property-c/60 hover:border-property-c',
    ring: 'ring-property-c/20',
    bubbleBg: 'bg-rose-50',
    bubbleBorder: 'border-rose-200',
    bubbleText: 'text-rose-950',
  },
};

export function getPropertyTheme(code: PropertyCode): PropertyThemeClasses {
  return PROPERTY_THEMES[code];
}

export function findPropertyById(
  properties: readonly Property[],
  propertyId: string,
): Property | undefined {
  return properties.find((property) => property.id === propertyId);
}

export function getPropertyDisplayLabel(property: Property): string {
  return `Property ${property.code} · ${property.name}`;
}

export function getOtherPropertiesUnreadCount(
  properties: readonly Property[],
  activePropertyId: string,
): number {
  return properties.reduce((total, property) => {
    if (property.id === activePropertyId) {
      return total;
    }
    return total + property.needsReplyCount + property.flaggedCount;
  }, 0);
}
