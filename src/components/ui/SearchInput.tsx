import { Search, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode } from 'react';

export interface SearchInputProps {
  id?: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder: string;
  ariaLabel?: string;
  rightSlot?: ReactNode;
  variant?: 'pill' | 'rounded';
  className?: string;
}

export function SearchInput({
  id,
  value,
  onChange,
  placeholder,
  ariaLabel,
  rightSlot,
  variant = 'pill',
  className = '',
}: SearchInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && value.length > 0) {
      event.preventDefault();
      onChange('');
    }
  };

  const radiusClass = variant === 'pill' ? 'rounded-full' : 'rounded-lg';

  return (
    <div
      className={`flex items-center gap-1.5 bg-white border border-light-outline-variant ${radiusClass} pl-3 pr-1.5 py-1.5 focus-within:border-light-primary focus-within:ring-1 focus-within:ring-light-primary transition ${className}`}
    >
      <Search className="w-4 h-4 text-slate-500 shrink-0 pointer-events-none" aria-hidden="true" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="w-full min-w-0 bg-white text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="w-6 h-6 rounded-full bg-stone-100 text-slate-600 hover:bg-stone-200 hover:text-slate-900 flex items-center justify-center shrink-0 transition"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
      {rightSlot && <div className="shrink-0">{rightSlot}</div>}
    </div>
  );
}
