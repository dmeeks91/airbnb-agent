import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export interface BottomSheetProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function BottomSheet({
  isOpen,
  title,
  subtitle,
  icon,
  onClose,
  children,
}: BottomSheetProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] flex items-end justify-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white w-full max-w-[420px] rounded-t-2xl border-t border-light-outline-variant flex flex-col max-h-[90vh]"
      >
        <div className="pt-3 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 bg-stone-300 rounded-full" aria-hidden="true" />
        </div>

        <div className="px-5 py-3 border-b border-light-outline-variant flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="shrink-0">{icon}</span>}
            <div className="min-w-0">
              <h2 className="font-headline text-headline-sm text-light-on-surface leading-tight truncate">
                {title}
              </h2>
              {subtitle && (
                <p className="text-body-sm text-light-secondary truncate">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sheet"
            className="w-9 h-9 rounded-full bg-light-surface-container-low border border-light-outline-variant flex items-center justify-center text-light-secondary hover:text-light-on-surface transition shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto overscroll-contain max-h-[calc(90vh-110px)]">
          {children}
        </div>
      </div>
    </div>
  );
}
