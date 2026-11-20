# Guest Co-Host: Design System & Visual Spec

Extracted from Stitch project **Co-Host Guest Relay UX** (`Haven — Co-Host Design System` + `Interactive Workflow Prototype` saved at `docs/stitch_prototype_reference.html`).

## 1. Visual Direction

Calm, modern hospitality aesthetic tailored for one-handed mobile triage on Android (390px to 420px primary column, centered with subtle neutral side borders on wider viewports). Soft warm off-white surfaces (`#FAFAF9`), deep slate primary actions (`#0F172A`), warm terracotta warnings (`#8C4000` on `#FEF3C7`), and distinct property indicator hues (Teal, Ochre, Rose).

No heavy drop shadows. Elevation comes from tonal surface layering (`surface` -> `surface-container-low` -> `white` cards) and hairline `1px` warm borders (`#D6D3D1`).

---

## 2. Design Tokens

### Colors
```css
:root {
  color-scheme: light;

  /* Property Accents */
  --color-property-a: #095C57;
  --color-property-b: #8C4A00;
  --color-property-c: #7F2A44;

  /* Semantic Status */
  --color-warning: #8C4000;
  --color-warning-surface: #FEF3C7;
  --color-success: #166534;
  --color-success-surface: #DCFCE7;
  --color-info: #1D4ED8;
  --color-info-surface: #DBEAFE;

  /* Core Light Palette */
  --color-light-primary: #0F172A;
  --color-light-on-primary: #FFFFFF;
  --color-light-primary-container: #F1F5F9;
  --color-light-on-primary-container: #0F172A;
  --color-light-secondary: #334155;
  --color-light-on-secondary: #FFFFFF;
  --color-light-secondary-container: #E2E8F0;
  --color-light-on-secondary-container: #1E293B;
  --color-light-tertiary: #7C2D12;
  --color-light-on-tertiary: #FFFFFF;
  --color-light-tertiary-container: #FFEDD5;
  --color-light-on-tertiary-container: #7C2D12;

  /* Warm Neutrals */
  --color-light-surface: #FAFAF9;
  --color-light-on-surface: #0F172A;
  --color-light-surface-container-low: #F5F5F4;
  --color-light-surface-container: #E7E5E4;
  --color-light-surface-container-high: #D6D3D1;
  --color-light-outline: #57534E;
  --color-light-outline-variant: #D6D3D1;
}
```

### Typography
* **Headlines / Display:** `Alata`, system sans fallback (`display-lg` 34/40px, `display-lg-mobile` 28/34px, `headline-lg` 24/30px, `headline-md` 20/26px, `headline-sm` 17/22px; weight 400).
* **Body & Labels:** `Instrument Sans`, system sans fallback (`body-lg` 16/24px, `body-md` 14/20px, `body-sm` 12/16px weight 400; `label-lg` 14/20px, `label-md` 12/16px, `label-sm` 11/14px weight 600).
* **Codes / Timestamps:** `Source Code Pro`, monospace fallback (`code-sm` 12/16px weight 500).
* Note: Load Google Fonts cleanly in `index.html` for production PWA with graceful local sans/mono fallbacks so offline PWA launches never flash broken text.

### Radii, Spacing & Motion
* **Radii:** `sm: 6px`, `DEFAULT: 10px`, `md: 12px` (primary buttons & inputs), `lg: 16px` (cards & sheets), `xl: 20px`, `full: 9999px` (pills/chips).
* **Spacing:** 8px grid with 4px half-steps (`gutter-xs: 4px`, `gutter-sm: 8px`, `gutter-md: 12px`, `gutter-lg: 16px`, `gutter-xl: 24px`, `section: 32px`, `page-margin: 16px`).
* **Motion:** `state-change: 120ms ease-out`, `surface-enter: 200ms cubic-bezier(0.16, 1, 0.3, 1)`, `surface-exit: 150ms cubic-bezier(0.4, 0, 1, 1)`.

---

## 3. Screen Inventory (Reference: `docs/stitch_prototype_reference.html`)

All mobile views live inside a centered `max-w-[420px] min-h-screen` app shell on `#FAFAF9` with a sticky bottom navigation bar on top-level tabs (`Messages`, `House Details`, `Account`):

1. **Messages (`#viewQueue`):**
   * Sticky top header with app title and top-right **Property Switcher** dropdown showing the active property color dot, name, and an unread badge whenever another property has threads waiting.
   * Compact **SearchInput** with an embedded `Filter` trigger tucked into the right edge opening an inline filter popover (`Status` + `Guest Stage`).
   * **Conditional Unmatched Banner** (V1 addition): Hidden when count is 0. When unmatched emails exist, renders a warm warning card allowing one-tap assignment to a property.
   * Active `Needs Reply` and `Flagged` cards sorted to the top (single-line header, stay dates, stacked unanswered guest message preview, optional payout warning chip, quick `View thread` link, and quiet `Dismiss` / handled-on-Airbnb action).
   * Resolved / `Sent` cards collapsed to compact two-line rows underneath.
2. **Agent Dialogue (`#viewDialogue`):**
   * Minimal sticky header with back arrow to Messages, guest name + stay dates, `View thread` link, and overflow/quiet `Already handled on Airbnb` dismiss trigger.
   * Optional **Discount / Net Payout Warning Banner** (`#FEF3C7` surface, `#8C4000` ink) showing the 15.5% host-only fee breakdown and a one-tap toggle between **All-in quote** and **Room rate only**.
   * Collapsible pinned unanswered guest message burst directly above the AI dialogue.
   * **On-demand Turn 1 draft** (clean loading skeleton while Vertex AI runs on first open) followed by multi-turn coaching bubbles and bottom composer.
   * Draft cards include inline `Edit` toggle (explicit white textarea), primary `Copy & Open Airbnb` button (deep-linking to the thread or pending reservation URL), and always-visible `Mark as Sent` button.
   * If a new guest message arrives mid-session, shows `"New guest message arrived · Refresh draft"` without overwriting live edits.
3. **Guest Thread (`#viewThread`):**
   * Full-screen chronological message feed (guest bubbles left, host/co-host bubbles right) with collapsed coaching notes disclosures and a sticky bottom bar to open `Agent Dialogue` or `+ Log manual reply`.
   * Preserves in-progress draft edits when navigating back to `Agent Dialogue`.
4. **House Details (`#viewHouseDetails`):**
   * Property switcher header + collapsible Knowledge Sources card + `+ Import` CTA.
   * Pricing & Guardrails card with separate fields for **Nightly Price Floor**, **Listed Cleaning Fee**, **Local Tax %**, **Host Service Fee %** (default 15.5%), and optional **Per-Property Sign-Off Override** (for co-hosted vs. primary-hosted listings).
   * Searchable, categorized rules (`Access & Arrival`, `Timings & Rates`, `Amenities & Rules`) inside bounded mobile scroll containers with tap-to-edit rows and subtle badges for temporary/expiring notes.
   * Dedicated **Vendor Contacts** card with one-tap `tel:` call links and add/edit bottom sheet.
5. **Rule Details Bottom Sheet (inside House Details):**
   * Reusable `BottomSheet` with grab handle, rule topic, ground-truth value textarea, custom `SelectPopover` for category, origin metadata, **Temporary / Seasonal Note** toggle + custom `DatePickerPopover` for expiration date, primary Save button, and quiet Delete trigger.
6. **Import Knowledge (`#viewImport`):**
   * Target property indicator pill + segmented source selector with three V1 paths: **Paste Text / Notes**, **PDF Upload**, and **Quick One-Liner**.
   * Extracted facts review checklist showing `New rule` vs. `Updates existing rule` conflict diffs before merging, plus a sticky bottom confirmation dock.
7. **Account (`#viewAccount`):**
   * Signed-in profile card (Google Sign-In allowlist status), **Android Push Alerts** toggle, **Gmail Watch & Sync Health** status card (showing dual-inbox forwarding status and watch expiry), **Sign-Off & Style Guardrails**, and **Learned Voice Diffs** list (capped at 15, individually deletable).

---

## 4. Final V1 Overrides vs. Earlier Stitch Prototype

Whenever `docs/stitch_prototype_reference.html` conflicts with `docs/IMPLEMENTATION_PLAN.md`, **always follow `docs/IMPLEMENTATION_PLAN.md`**:

* **Remove prototype chrome:** Do not render the Stitch prototype's top journey breadcrumb bar (`Views: Messages | Full Thread | ...`) or emulated Android status bar.
* **Icons:** Use `lucide-react` inline SVGs throughout React rather than Google Material Symbols webfont spans.
* **No claim/release locks:** Ignore the `Claimed by You` / `Unclaimed` / `I'm on this` badge patterns from the earlier design-system overview.
* **Import sources:** Replace Stitch's "Airbnb Link Sync" and "DOCX" inputs with **Paste Text / Notes**, **PDF Upload**, and **Quick One-Liner**.
* **Custom input primitives:** Never use native `<select>` or `<input type="date">`. Use `SelectPopover`, `DatePickerPopover`, and `SearchInput` with explicit light-mode backgrounds (`bg-white` or `bg-stone-50`, `text-slate-900`, `placeholder:text-slate-400`) and `:root { color-scheme: light; }`.
* **Zero simulation CTAs:** Never add fake demo/bypass buttons (e.g. "Simulate incoming email" or "Fake accept") to the production UI; drive tests and local dev through real state fixtures and real user flows.
