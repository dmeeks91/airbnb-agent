import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCalendarDate, toIsoDateString } from '../../utils/dateFormat.ts';

export interface DatePickerPopoverProps {
  id?: string;
  label?: string;
  value: string | null;
  onChange: (nextIsoDate: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function parseIsoParts(isoDate: string | null): { year: number; month: number } {
  if (isoDate) {
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return {
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10) - 1,
      };
    }
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function addDaysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toIsoDateString(date);
}

function endOfCurrentMonthIso(): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return toIsoDateString(lastDay);
}

export function DatePickerPopover({
  id,
  label,
  value,
  onChange,
  placeholder = 'Select expiration date',
  disabled = false,
  className = '',
}: DatePickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const initial = parseIsoParts(value);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth, setViewMonth] = useState(initial.month);
  const containerRef = useRef<HTMLDivElement>(null);

  const todayIso = useMemo(() => toIsoDateString(new Date()), []);

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const calendarCells = useMemo(() => {
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const leadingBlanks = firstOfMonth.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    const cells: Array<{ iso: string; day: number } | null> = [];
    for (let i = 0; i < leadingBlanks; i++) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({ iso, day });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const monthHeading = useMemo(
    () =>
      new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      }),
    [viewYear, viewMonth],
  );

  const openPicker = () => {
    if (disabled) {
      return;
    }
    const parts = parseIsoParts(value);
    setViewYear(parts.year);
    setViewMonth(parts.month);
    setIsOpen(true);
  };

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const selectDate = (isoDate: string) => {
    onChange(isoDate);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1.5">
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={label ?? placeholder}
          onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
          className="flex-1 min-h-[42px] px-3 py-2 bg-white border border-light-outline-variant rounded-md text-left text-body-md text-slate-900 flex items-center justify-between gap-2 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20 disabled:opacity-50 transition"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            <span className={value ? 'text-slate-900 font-medium' : 'text-slate-400'}>
              {value ? formatCalendarDate(value) : placeholder}
            </span>
          </span>
        </button>

        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Clear expiration date"
            className="min-h-[42px] px-2.5 rounded-md bg-white border border-light-outline-variant text-slate-500 hover:text-slate-900 hover:bg-stone-50 transition"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {isOpen && (
        <div
          role="dialog"
          aria-label={label ?? 'Choose date'}
          className="fixed inset-x-4 bottom-6 z-[60] max-w-[360px] mx-auto md:absolute md:inset-x-auto md:left-0 md:bottom-auto md:top-full md:mt-1.5 w-full bg-white rounded-lg border border-light-outline-variant shadow-lg p-3 flex flex-col gap-3"
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => selectDate(addDaysFromToday(7))}
              className="px-2.5 py-1 rounded-full bg-stone-100 text-slate-800 hover:bg-stone-200 text-label-sm font-semibold transition"
            >
              In 7 days
            </button>
            <button
              type="button"
              onClick={() => selectDate(addDaysFromToday(30))}
              className="px-2.5 py-1 rounded-full bg-stone-100 text-slate-800 hover:bg-stone-200 text-label-sm font-semibold transition"
            >
              In 30 days
            </button>
            <button
              type="button"
              onClick={() => selectDate(endOfCurrentMonthIso())}
              className="px-2.5 py-1 rounded-full bg-stone-100 text-slate-800 hover:bg-stone-200 text-label-sm font-semibold transition"
            >
              End of month
            </button>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={goPrevMonth}
              aria-label="Previous month"
              className="w-8 h-8 rounded-full bg-stone-50 border border-light-outline-variant flex items-center justify-center text-slate-700 hover:bg-stone-100 transition"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="text-label-lg font-semibold text-slate-900">{monthHeading}</span>
            <button
              type="button"
              onClick={goNextMonth}
              aria-label="Next month"
              className="w-8 h-8 rounded-full bg-stone-50 border border-light-outline-variant flex items-center justify-center text-slate-700 hover:bg-stone-100 transition"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((weekday) => (
              <span
                key={weekday}
                className="text-[11px] font-semibold text-slate-500 py-1"
              >
                {weekday}
              </span>
            ))}
            {calendarCells.map((cell, idx) => {
              if (!cell) {
                return <span key={`blank-${idx}`} className="h-8" />;
              }
              const isSelected = value === cell.iso;
              const isToday = todayIso === cell.iso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => selectDate(cell.iso)}
                  aria-label={formatCalendarDate(cell.iso)}
                  aria-pressed={isSelected}
                  className={`h-8 rounded-md text-body-sm font-medium transition ${
                    isSelected
                      ? 'bg-light-primary text-white font-semibold'
                      : isToday
                        ? 'bg-stone-100 text-slate-900 border border-slate-400 font-semibold'
                        : 'text-slate-800 hover:bg-stone-100'
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
