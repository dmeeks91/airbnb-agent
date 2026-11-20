import { Building2, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Property } from '../types/cohost.ts';
import { getPropertyTheme } from '../utils/propertyHelpers.ts';

export interface PropertySwitcherProps {
  properties: readonly Property[];
  activePropertyId: string;
  otherPropertiesUnreadCount: number;
  onSelectProperty: (propertyId: string) => void;
}

export function PropertySwitcher({
  properties,
  activePropertyId,
  otherPropertiesUnreadCount,
  onSelectProperty,
}: PropertySwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Switch property"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="relative w-10 h-10 rounded-full bg-light-surface-container-low border border-light-outline-variant text-light-secondary flex items-center justify-center hover:bg-light-surface-container active:scale-95 transition"
      >
        <Building2 className="w-[18px] h-[18px]" aria-hidden="true" />
        {otherPropertiesUnreadCount > 0 && (
          <span
            aria-label={`${otherPropertiesUnreadCount} waiting on other properties`}
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-warning text-white text-[10px] font-code font-semibold flex items-center justify-center border-2 border-light-surface"
          >
            {otherPropertiesUnreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Properties"
          className="absolute right-0 top-12 w-64 bg-white rounded-lg border border-light-outline-variant shadow-lg p-2 z-40 flex flex-col gap-1"
        >
          <div className="px-2 py-1 text-[11px] font-label text-light-secondary uppercase tracking-wider border-b border-light-outline-variant/60 flex items-center justify-between">
            <span>Switch Property</span>
            <span className="font-code text-light-outline">{properties.length} active</span>
          </div>

          {properties.map((property) => {
            const isSelected = property.id === activePropertyId;
            const theme = getPropertyTheme(property.code);
            const waitingCount = property.needsReplyCount + property.flaggedCount;

            return (
              <button
                key={property.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onSelectProperty(property.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between p-2.5 rounded-md transition text-left border ${
                  isSelected
                    ? `${theme.softBg} ${theme.softBorder}`
                    : 'border-transparent hover:bg-light-surface-container-low'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${theme.dotBg}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-label text-label-md font-semibold truncate ${
                          isSelected ? theme.text : 'text-light-on-surface'
                        }`}
                      >
                        Property {property.code}
                      </span>
                      {property.flaggedCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-warning-surface text-warning font-code text-[10px] font-semibold">
                          {property.flaggedCount} flagged
                        </span>
                      )}
                      {property.flaggedCount === 0 && waitingCount > 0 && (
                        <span
                          className={`px-1.5 py-0.5 rounded-full font-code text-[10px] font-semibold ${theme.badgeBg}`}
                        >
                          {waitingCount} waiting
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-light-secondary block truncate">
                      {property.name}
                    </span>
                  </div>
                </div>
                {isSelected && (
                  <Check className={`w-4 h-4 shrink-0 ${theme.text}`} aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
