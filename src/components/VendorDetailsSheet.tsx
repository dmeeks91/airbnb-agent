import { PhoneCall, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BottomSheet } from './ui/BottomSheet.tsx';
import type { PropertyVendor } from '../types/haven.ts';

export interface VendorDetailsSheetProps {
  isOpen: boolean;
  vendor: PropertyVendor | null;
  onClose: () => void;
  onSave: (vendor: PropertyVendor) => Promise<void>;
  onDelete?: (vendorId: string) => Promise<void>;
}

function VendorFormBody({
  vendor,
  onClose,
  onSave,
  onDelete,
}: {
  vendor: PropertyVendor | null;
  onClose: () => void;
  onSave: (vendor: PropertyVendor) => Promise<void>;
  onDelete?: (vendorId: string) => Promise<void>;
}) {
  const [name, setName] = useState(vendor?.name ?? '');
  const [role, setRole] = useState(vendor?.role ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const canSave = name.trim().length > 0 && phone.trim().length > 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      await onSave({
        id: vendor?.id ?? `vendor-${Date.now()}`,
        name: name.trim(),
        role: role.trim() || 'Service Vendor',
        phone: phone.trim(),
        notes: notes.trim(),
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="vendor-name-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Vendor Name
        </label>
        <input
          id="vendor-name-input"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Bay Plumbing"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="vendor-role-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Role / Trade
        </label>
        <input
          id="vendor-role-input"
          type="text"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          placeholder="e.g. Turnover Cleaning, Locksmith, HVAC"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="vendor-phone-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Phone Number
        </label>
        <input
          id="vendor-phone-input"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="(804) 555-0199"
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 text-body-md font-code text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="vendor-notes-input"
          className="font-label text-label-sm uppercase tracking-wider text-light-secondary font-semibold"
        >
          Account / Dispatch Notes
        </label>
        <input
          id="vendor-notes-input"
          type="text"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Acct #, SMS priority, backup key info..."
          className="w-full min-h-[42px] bg-white border border-light-outline-variant rounded-md px-3 py-2 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-light-primary focus:ring-2 focus:ring-light-primary/20"
        />
      </div>

      <div className="pt-2 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[42px] rounded-md border border-light-outline-variant bg-white font-label text-label-md font-semibold text-light-secondary hover:bg-stone-50 transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave || isSaving}
            className="flex-1 min-h-[42px] rounded-md bg-light-primary text-white font-label text-label-md font-semibold disabled:opacity-40 transition"
          >
            Save Vendor
          </button>
        </div>

        {vendor && onDelete && (
          <button
            type="button"
            onClick={async () => {
              setIsSaving(true);
              try {
                await onDelete(vendor.id);
                onClose();
              } finally {
                setIsSaving(false);
              }
            }}
            className="w-full min-h-[38px] text-center font-label text-label-md font-semibold text-rose-700 hover:underline flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span>Remove Vendor</span>
          </button>
        )}
      </div>
    </form>
  );
}

export function VendorDetailsSheet({
  isOpen,
  vendor,
  onClose,
  onSave,
  onDelete,
}: VendorDetailsSheetProps) {
  return (
    <BottomSheet
      isOpen={isOpen}
      title={vendor ? 'Edit Vendor Contact' : 'Add Vendor Contact'}
      subtitle="Quick-dial operational contacts (readable offline)"
      icon={<PhoneCall className="w-5 h-5 text-property-a" aria-hidden="true" />}
      onClose={onClose}
    >
      {isOpen && (
        <VendorFormBody
          key={vendor?.id ?? 'new-vendor'}
          vendor={vendor}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </BottomSheet>
  );
}
