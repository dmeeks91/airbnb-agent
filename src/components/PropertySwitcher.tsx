import { ArrowUpDown, Building2, Check, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Property } from '../types/cohost.ts';
import { getPropertyTheme } from '../utils/propertyHelpers.ts';

export interface PropertySwitcherProps {
  properties: readonly Property[];
  activePropertyId: string;
  otherPropertiesUnreadCount: number;
  onSelectProperty: (propertyId: string) => void;
  onAddProperty?: () => void;
  onReorderProperties?: (orderedIds: readonly string[]) => Promise<void>;
}

export function PropertySwitcher({
  properties,
  activePropertyId,
  otherPropertiesUnreadCount,
  onSelectProperty,
  onAddProperty,
  onReorderProperties,
}: PropertySwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const canReorder = Boolean(onReorderProperties && properties.length > 1);

  const closeMenu = () => {
    setIsOpen(false);
    setIsReordering(false);
  };

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
        setIsReordering(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setIsReordering(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handleMoveProperty = (index: number, delta: -1 | 1) => {
    if (!onReorderProperties) {
      return;
    }
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= properties.length) {
      return;
    }
    const nextIds = properties.map((property) => property.id);
    const [moved] = nextIds.splice(index, 1);
    nextIds.splice(targetIndex, 0, moved);
    void onReorderProperties(nextIds);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (isOpen) {
            closeMenu();
          } else {
            setIsOpen(true);
          }
        }}
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
          className="absolute right-0 top-12 w-72 bg-white rounded-lg border border-light-outline-variant shadow-lg p-2 z-40 flex flex-col gap-1"
        >
          <div className="px-2 py-1 text-[11px] font-label text-light-secondary uppercase tracking-wider border-b border-light-outline-variant/60 flex items-center justify-between gap-2">
            <span>{isReordering ? 'Reorder Properties' : 'Switch Property'}</span>
            {canReorder ? (
              <button
                type="button"
                onClick={() => setIsReordering((prev) => !prev)}
                className={
                  isReordering
                    ? 'normal-case tracking-normal text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-light-primary text-white hover:opacity-90 transition'
                    : 'normal-case tracking-normal text-[11px] font-semibold px-2 py-0.5 rounded-md border border-light-outline-variant bg-stone-50 text-light-secondary hover:bg-stone-100 transition inline-flex items-center gap-1'
                }
              >
                {!isReordering && <ArrowUpDown className="w-3 h-3" aria-hidden="true" />}
                <span>{isReordering ? 'Done' : 'Reorder'}</span>
              </button>
            ) : (
              <span className="font-code text-light-outline">{properties.length} active</span>
            )}
          </div>

          {properties.map((property, index) => {
            const isSelected = property.id === activePropertyId;
            const theme = getPropertyTheme(property.code);
            const waitingCount = property.needsReplyCount + property.flaggedCount;

            if (isReordering) {
              return (
                <div
                  key={property.id}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md border border-light-outline-variant/70 bg-stone-50/70"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-code text-[11px] text-light-outline w-3 shrink-0">
                      {index + 1}
                    </span>
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${theme.dotBg}`}
                      aria-hidden="true"
                    />
                    <span className="font-label text-label-md font-semibold text-light-on-surface truncate">
                      {property.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMoveProperty(index, -1)}
                      aria-label={`Move ${property.name} up`}
                      className="w-8 h-8 rounded-md border border-light-outline-variant bg-white text-light-secondary hover:bg-stone-100 disabled:opacity-30 flex items-center justify-center transition"
                    >
                      <ChevronUp className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={index === properties.length - 1}
                      onClick={() => handleMoveProperty(index, 1)}
                      aria-label={`Move ${property.name} down`}
                      className="w-8 h-8 rounded-md border border-light-outline-variant bg-white text-light-secondary hover:bg-stone-100 disabled:opacity-30 flex items-center justify-center transition"
                    >
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={property.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onSelectProperty(property.id);
                  closeMenu();
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
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span
                      className={`font-label text-label-md font-semibold truncate ${
                        isSelected ? theme.text : 'text-light-on-surface'
                      }`}
                    >
                      {property.name}
                    </span>
                    {property.flaggedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-warning-surface text-warning font-code text-[10px] font-semibold shrink-0">
                        {property.flaggedCount} flagged
                      </span>
                    )}
                    {property.flaggedCount === 0 && waitingCount > 0 && (
                      <span
                        className={`px-1.5 py-0.5 rounded-full font-code text-[10px] font-semibold shrink-0 ${theme.badgeBg}`}
                      >
                        {waitingCount} waiting
                      </span>
                    )}
                  </div>
                </div>
                {isSelected && (
                  <Check className={`w-4 h-4 shrink-0 ${theme.text}`} aria-hidden="true" />
                )}
              </button>
            );
          })}

          {onAddProperty && !isReordering && (
            <div className="pt-1 mt-1 border-t border-light-outline-variant/60">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onAddProperty();
                }}
                className="w-full min-h-[38px] px-2.5 py-2 rounded-md text-label-md font-semibold text-light-on-surface hover:bg-light-surface-container-low flex items-center gap-2 transition"
              >
                <Plus className="w-4 h-4 text-light-secondary" aria-hidden="true" />
                <span>Add Property</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
