import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  swatchColor?: string;
  badge?: string;
  tone?: 'default' | 'danger';
  dividerBefore?: boolean;
  icon?: ReactNode;
}

export interface SelectPopoverProps<T extends string = string> {
  id?: string;
  label?: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (nextValue: T) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  anchorMode?: 'responsive' | 'anchored';
  compact?: boolean;
  className?: string;
}

interface AnchoredMenuPosition {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

function computeAnchoredPosition(trigger: HTMLButtonElement | null): AnchoredMenuPosition {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 420;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 844;
  const margin = 12;

  if (!trigger) {
    return {
      top: 80,
      left: margin,
      width: Math.min(320, viewportWidth - margin * 2),
      maxHeight: 240,
    };
  }

  const rect = trigger.getBoundingClientRect();
  const hasRealRect = rect.width > 0 || rect.height > 0;
  if (!hasRealRect) {
    return {
      top: 80,
      left: margin,
      width: Math.min(320, viewportWidth - margin * 2),
      maxHeight: 240,
    };
  }

  const width = Math.min(Math.max(rect.width, 180), viewportWidth - margin * 2);
  const left = Math.max(margin, Math.min(rect.left, viewportWidth - width - margin));
  const spaceBelow = viewportHeight - rect.bottom - margin - 6;
  const spaceAbove = rect.top - margin - 6;
  const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;

  if (openAbove) {
    return {
      bottom: viewportHeight - rect.top + 6,
      left,
      width,
      maxHeight: Math.max(120, Math.min(260, spaceAbove)),
    };
  }

  return {
    top: rect.bottom + 6,
    left,
    width,
    maxHeight: Math.max(120, Math.min(260, spaceBelow)),
  };
}

export function SelectPopover<T extends string = string>({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = 'Select an option',
  searchable,
  disabled = false,
  anchorMode = 'responsive',
  compact = false,
  className = '',
}: SelectPopoverProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchoredPos, setAnchoredPos] = useState<AnchoredMenuPosition | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const shouldShowSearch = searchable ?? options.length > 6;

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return options;
    }
    return options.filter((option) => {
      const text = `${option.label} ${option.description ?? ''} ${option.badge ?? ''}`.toLowerCase();
      return text.includes(trimmed);
    });
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      const inContainer = containerRef.current?.contains(event.target) ?? false;
      const inMenu = menuRef.current?.contains(event.target) ?? false;
      if (!inContainer && !inMenu) {
        setIsOpen(false);
        setQuery('');
      }
    };
    const handleEscapeCapture = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        setQuery('');
        triggerRef.current?.focus();
      }
    };
    const handleAnchoredScroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        menuRef.current &&
        menuRef.current.contains(event.target)
      ) {
        return;
      }
      setIsOpen(false);
      setQuery('');
    };
    const handleResize = () => {
      if (anchorMode === 'anchored') {
        setIsOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscapeCapture, true);
    if (anchorMode === 'anchored') {
      window.addEventListener('scroll', handleAnchoredScroll, true);
      window.addEventListener('resize', handleResize);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscapeCapture, true);
      if (anchorMode === 'anchored') {
        window.removeEventListener('scroll', handleAnchoredScroll, true);
        window.removeEventListener('resize', handleResize);
      }
    };
  }, [isOpen, anchorMode]);

  const openMenu = () => {
    if (disabled) {
      return;
    }
    const selectedIdx = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : 0);
    if (anchorMode === 'anchored') {
      setAnchoredPos(computeAnchoredPosition(triggerRef.current));
    }
    setIsOpen(true);
    if (shouldShowSearch) {
      queueMicrotask(() => searchInputRef.current?.focus());
    }
  };

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false);
    setQuery('');
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  const selectOption = (option: SelectOption<T>) => {
    onChange(option.value);
    closeMenu(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled) {
      return;
    }

    if (!isOpen) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    if (event.key === 'Tab') {
      closeMenu(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) =>
        filteredOptions.length === 0 ? 0 : (prev + 1) % filteredOptions.length,
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) =>
        filteredOptions.length === 0
          ? 0
          : (prev - 1 + filteredOptions.length) % filteredOptions.length,
      );
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const candidate = filteredOptions[activeIndex];
      if (candidate) {
        selectOption(candidate);
      }
    }
  };

  const menuContent = (
    <div
      ref={menuRef}
      style={
        anchorMode === 'anchored' && anchoredPos
          ? {
              position: 'fixed',
              left: `${anchoredPos.left}px`,
              width: `${anchoredPos.width}px`,
              ...(anchoredPos.top !== undefined ? { top: `${anchoredPos.top}px` } : {}),
              ...(anchoredPos.bottom !== undefined ? { bottom: `${anchoredPos.bottom}px` } : {}),
            }
          : undefined
      }
      className={
        anchorMode === 'anchored'
          ? 'z-[70] bg-white rounded-lg border border-light-outline-variant shadow-lg overflow-hidden'
          : 'fixed inset-x-4 bottom-6 z-[60] max-w-[388px] mx-auto md:absolute md:inset-x-0 md:bottom-auto md:top-full md:mt-1.5 bg-white rounded-lg border border-light-outline-variant shadow-lg overflow-hidden'
      }
    >
      {shouldShowSearch && (
        <div className="p-2 border-b border-light-outline-variant bg-stone-50">
          <div className="flex items-center gap-1.5 bg-white border border-light-outline-variant rounded-md px-2.5 py-1.5">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              placeholder="Filter options..."
              aria-label="Filter options"
              className="w-full bg-white text-body-sm text-slate-900 placeholder:text-slate-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear filter"
                className="text-slate-500 hover:text-slate-900"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      <ul
        id={listboxId}
        role="listbox"
        aria-label={label ?? placeholder}
        style={
          anchorMode === 'anchored' && anchoredPos
            ? { maxHeight: `${anchoredPos.maxHeight}px` }
            : undefined
        }
        className="max-h-60 overflow-y-auto overscroll-contain p-1.5 flex flex-col gap-0.5"
      >
        {filteredOptions.length === 0 && (
          <li className="px-3 py-2 text-body-sm text-slate-500">No matching options</li>
        )}
        {filteredOptions.map((option, index) => {
          const isSelected = option.value === value;
          const isHighlighted = index === activeIndex;
          const isDanger = option.tone === 'danger';
          return (
            <li
              key={option.value}
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
              className={`px-2.5 py-2 rounded-md cursor-pointer flex items-center justify-between gap-2 transition ${
                option.dividerBefore ? 'mt-1 pt-2.5 border-t border-light-outline-variant/80 rounded-t-none' : ''
              } ${
                isDanger
                  ? isHighlighted
                    ? 'bg-red-50 text-red-700'
                    : 'text-red-700 hover:bg-red-50'
                  : isSelected
                    ? 'bg-slate-100 text-slate-900'
                    : isHighlighted
                      ? 'bg-stone-100 text-slate-900'
                      : 'text-slate-800 hover:bg-stone-50'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {option.swatchColor && (
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                    style={{ backgroundColor: option.swatchColor }}
                    aria-hidden="true"
                  />
                )}
                {option.icon && <span className="shrink-0 mt-0.5">{option.icon}</span>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`${compact ? 'text-body-sm' : 'text-body-md'} ${
                        isDanger ? 'font-semibold' : 'font-medium'
                      } truncate`}
                    >
                      {option.label}
                    </span>
                    {option.badge && (
                      <span className="px-1.5 py-0.5 rounded-full bg-stone-200/80 text-slate-700 text-[10px] font-code shrink-0">
                        {option.badge}
                      </span>
                    )}
                  </div>
                  {option.description && (
                    <p className="text-body-sm text-slate-500 truncate">{option.description}</p>
                  )}
                </div>
              </div>
              {isSelected && !isDanger && (
                <Check className="w-4 h-4 text-light-primary shrink-0" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={label}
        onClick={() => (isOpen ? closeMenu(false) : openMenu())}
        className={`w-full ${
          compact ? 'min-h-[38px] px-2.5 py-1.5 text-label-md' : 'min-h-[42px] px-3 py-2 text-body-md'
        } bg-white border border-light-outline-variant rounded-md text-left text-slate-900 flex items-center justify-between gap-2 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20 disabled:opacity-50 transition`}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1">
          {selectedOption?.swatchColor && (
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selectedOption.swatchColor }}
              aria-hidden="true"
            />
          )}
          <span
            className={`truncate font-medium ${
              selectedOption ? 'text-slate-900' : 'text-slate-600'
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span className="px-1.5 py-0.5 rounded-full bg-stone-100 text-slate-700 text-[11px] font-code shrink-0">
              {selectedOption.badge}
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen &&
        (anchorMode === 'anchored' && typeof document !== 'undefined'
          ? createPortal(menuContent, document.body)
          : menuContent)}
    </div>
  );
}
