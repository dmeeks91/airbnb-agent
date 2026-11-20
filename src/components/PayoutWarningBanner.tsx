import { AlertTriangle, Calculator } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DiscountAlert, PayoutAssumption, PropertyPricing } from '../types/haven.ts';
import { recalculateDiscountAlert } from '../utils/payoutHelpers.ts';

export interface PayoutWarningBannerProps {
  alert: DiscountAlert;
  pricing: PropertyPricing;
}

function formatMoney(amount: number): string {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PayoutWarningBanner({ alert, pricing }: PayoutWarningBannerProps) {
  const [assumption, setAssumption] = useState<PayoutAssumption>(alert.defaultAssumption);

  const liveAlert = useMemo(
    () => recalculateDiscountAlert(alert, pricing),
    [alert, pricing],
  );
  const active = assumption === 'all_in' ? liveAlert.allIn : liveAlert.roomOnly;

  return (
    <section
      aria-label="Net payout breakdown"
      className="mx-4 mt-3 p-3.5 rounded-lg bg-warning-surface border border-amber-300 flex flex-col gap-3"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className="w-5 h-5 text-warning shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-label text-label-md font-semibold text-warning">
              {active.belowFloor
                ? 'Below Your Net Nightly Floor'
                : 'Meets Your Net Nightly Floor'}
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-white/80 border border-amber-300 font-code text-[11px] font-semibold text-amber-950">
              {formatMoney(active.estimatedNetPerNight)}/nt net
            </span>
          </div>
          <p className="text-body-sm text-amber-950 mt-0.5">
            Guest offered {formatMoney(alert.offeredAmount)} for {alert.nights}{' '}
            {alert.nights === 1 ? 'night' : 'nights'}. Private floor is{' '}
            {formatMoney(active.floorPerNight)}/nt (
            {active.deltaPerNight >= 0 ? '+' : '-'}
            {formatMoney(Math.abs(active.deltaPerNight))}/nt).
          </p>
        </div>
      </div>

      <div
        role="group"
        aria-label="Guest quote assumption"
        className="grid grid-cols-2 gap-1 p-1 rounded-md bg-white/80 border border-amber-300/80"
      >
        <button
          type="button"
          onClick={() => setAssumption('all_in')}
          aria-pressed={assumption === 'all_in'}
          className={`min-h-[36px] px-2.5 py-1.5 rounded text-label-sm font-semibold transition ${
            assumption === 'all_in'
              ? 'bg-light-primary text-white'
              : 'text-amber-950 hover:bg-amber-100/70'
          }`}
        >
          All-in (incl. tax &amp; clean)
        </button>
        <button
          type="button"
          onClick={() => setAssumption('room_only')}
          aria-pressed={assumption === 'room_only'}
          className={`min-h-[36px] px-2.5 py-1.5 rounded text-label-sm font-semibold transition ${
            assumption === 'room_only'
              ? 'bg-light-primary text-white'
              : 'text-amber-950 hover:bg-amber-100/70'
          }`}
        >
          Room rate before tax
        </button>
      </div>

      <div className="bg-white/90 rounded-md border border-amber-200 p-2.5 flex flex-col gap-1 text-[12px] text-slate-800">
        <div className="flex items-center gap-1.5 text-[11px] font-label font-semibold text-slate-600 uppercase tracking-wider pb-1 border-b border-stone-200">
          <Calculator className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
          <span>Payout Math ({pricing.hostServiceFeePct}% host fee)</span>
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <span>Pre-tax subtotal (room + cleaning)</span>
          <span className="font-code font-medium">{formatMoney(active.preTaxSubtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-slate-600">
          <span>Est. occupancy tax ({pricing.localTaxPct}%)</span>
          <span className="font-code">{formatMoney(active.estimatedTax)}</span>
        </div>
        <div className="flex items-center justify-between text-slate-600">
          <span>Airbnb host fee ({pricing.hostServiceFeePct}%)</span>
          <span className="font-code">-{formatMoney(active.hostServiceFee)}</span>
        </div>
        <div className="flex items-center justify-between text-slate-600">
          <span>Listed cleaning fee</span>
          <span className="font-code">-{formatMoney(active.cleaningFee)}</span>
        </div>
        <div className="flex items-center justify-between pt-1.5 mt-0.5 border-t border-stone-200 font-semibold text-slate-900">
          <span>Est. net after cleaning ({alert.nights} nts)</span>
          <span className="font-code">
            {formatMoney(active.netAfterCleaning)} ({formatMoney(active.estimatedNetPerNight)}/nt)
          </span>
        </div>
      </div>
    </section>
  );
}
