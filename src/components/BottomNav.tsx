import { BookOpen, Inbox, User } from 'lucide-react';
import type { HavenAppView } from '../types/haven.ts';

export interface BottomNavProps {
  activeView: HavenAppView;
  totalWaitingCount: number;
  onNavigate: (view: 'messages' | 'house-details' | 'account') => void;
}

export function BottomNav({
  activeView,
  totalWaitingCount,
  onNavigate,
}: BottomNavProps) {
  const isMessages =
    activeView === 'messages' || activeView === 'dialogue' || activeView === 'thread';
  const isHouseDetails = activeView === 'house-details' || activeView === 'import';
  const isAccount = activeView === 'account';

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 left-0 right-0 max-w-[420px] mx-auto bg-white border-t border-light-outline-variant px-6 py-2 flex items-center justify-between z-30"
    >
      <button
        type="button"
        onClick={() => onNavigate('messages')}
        aria-current={isMessages ? 'page' : undefined}
        className={`relative min-h-[44px] px-3 flex flex-col items-center justify-center gap-0.5 font-label text-label-sm transition ${
          isMessages
            ? 'text-light-primary font-semibold'
            : 'text-light-secondary hover:text-light-on-surface'
        }`}
      >
        <span className="relative">
          <Inbox className="w-5 h-5" aria-hidden="true" />
          {totalWaitingCount > 0 && (
            <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-light-primary text-white text-[9px] font-code font-semibold flex items-center justify-center">
              {totalWaitingCount}
            </span>
          )}
        </span>
        <span>Messages</span>
      </button>

      <button
        type="button"
        onClick={() => onNavigate('house-details')}
        aria-current={isHouseDetails ? 'page' : undefined}
        className={`min-h-[44px] px-3 flex flex-col items-center justify-center gap-0.5 font-label text-label-sm transition ${
          isHouseDetails
            ? 'text-light-primary font-semibold'
            : 'text-light-secondary hover:text-light-on-surface'
        }`}
      >
        <BookOpen className="w-5 h-5" aria-hidden="true" />
        <span>House Details</span>
      </button>

      <button
        type="button"
        onClick={() => onNavigate('account')}
        aria-current={isAccount ? 'page' : undefined}
        className={`min-h-[44px] px-3 flex flex-col items-center justify-center gap-0.5 font-label text-label-sm transition ${
          isAccount
            ? 'text-light-primary font-semibold'
            : 'text-light-secondary hover:text-light-on-surface'
        }`}
      >
        <User className="w-5 h-5" aria-hidden="true" />
        <span>Account</span>
      </button>
    </nav>
  );
}
