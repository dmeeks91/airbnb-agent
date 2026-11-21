// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { createSeedSnapshot } from '../../data/seedData.ts';
import { createLocalCohostStore } from '../../services/cohostStore.ts';

afterEach(() => {
  cleanup();
});

describe('Stage 3: House Details, Rule Details Sheet, Import Knowledge & Account Journey', () => {
  it('edits pricing guardrails, manages temporary rules via custom SelectPopover and DatePickerPopover, and adds vendors', async () => {
    const user = userEvent.setup();
    const store = createLocalCohostStore();
    const { container } = render(<App store={store} />);

    // Navigate via Bottom Nav to House Details
    await user.click(screen.getByRole('button', { name: 'House Details' }));
    expect(document.body.contains(screen.getByText('Live Operational Values'))).toBe(true);

    // Update Min Nightly Payout and Per-Property Sign-Off Override
    const floorInput = screen.getByLabelText('Min Nightly Payout ($)');
    await user.clear(floorInput);
    await user.type(floorInput, '195');

    const signOffInput = screen.getByLabelText('Per-Property Sign-Off Override (Optional)');
    await user.type(signOffInput, 'Warmly, Alex (Coastal Loft)');
    await user.click(screen.getByRole('button', { name: 'Save Pricing & Sign-Off' }));

    await waitFor(() => {
      const coastal = store.getSnapshot().properties.find((p) => p.id === 'prop-coastal-loft');
      expect(coastal?.pricing.nightlyFloor).toBe(195);
      expect(coastal?.signOffOverride).toBe('Warmly, Alex (Coastal Loft)');
    });

    // Open Add Rule bottom sheet
    await user.click(screen.getByRole('button', { name: 'Add Rule' }));
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();

    await user.type(screen.getByLabelText('Rule Topic / Key'), 'Deck Heater Notice');
    await user.type(
      screen.getByLabelText('Ground Truth Value'),
      'Propane deck heater is serviced through next week.',
    );

    // Select Category via custom SelectPopover
    await user.click(screen.getByRole('button', { name: 'Rule category' }));
    await user.click(screen.getByRole('option', { name: /Timings & Rates/i }));

    // Toggle Temporary / Seasonal Note and pick date via custom DatePickerPopover
    await user.click(screen.getByRole('switch', { name: 'Temporary or seasonal note' }));
    await user.click(screen.getByRole('button', { name: 'Rule expiration date' }));
    await user.click(screen.getByRole('button', { name: 'In 7 days' }));

    const dialog = screen.getByRole('dialog', { name: 'Add House Rule' });
    await user.click(within(dialog).getByRole('button', { name: 'Add Rule' }));

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Deck Heater Notice'))).toBe(true);
    });

    // Add a new vendor contact and verify tel: link
    await user.click(screen.getByRole('button', { name: 'Add Vendor' }));
    await user.type(screen.getByLabelText('Vendor Name'), 'Harbor Electric');
    await user.type(screen.getByLabelText('Role / Trade'), 'Electrician');
    await user.type(screen.getByLabelText('Phone Number'), '(804) 555-0177');
    await user.click(screen.getByRole('button', { name: 'Save Vendor' }));

    await waitFor(() => {
      const callLink = screen.getByRole('link', { name: 'Call Harbor Electric' });
      expect(callLink.getAttribute('href')).toBe('tel:8045550177');
    });
  });

  it('extracts rules with conflict review (Updates existing rule vs New rule) and merges into House Details', async () => {
    const user = userEvent.setup();
    const store = createLocalCohostStore();
    render(<App store={store} initialView="house-details" />);

    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(document.body.contains(screen.getByText('Import House Details'))).toBe(true);

    // Verify only the V1 tabs exist (Paste Text and PDF Upload)
    expect(document.body.contains(screen.getByRole('tab', { name: 'Paste Text' }))).toBe(true);
    expect(document.body.contains(screen.getByRole('tab', { name: 'PDF Upload' }))).toBe(true);
    expect(screen.queryByRole('tab', { name: 'One-Liner' })).toBeNull();
    expect(screen.queryByText(/Airbnb Link/i)).toBeNull();

    // Paste text with one conflict (Parking Allocation) and one new rule (Coffee Setup)
    const textArea = screen.getByLabelText('Listing Text or Host Notes');
    await user.type(
      textArea,
      'Parking Allocation: Two dedicated driveway spots available behind the house.\nCoffee Setup: Drip coffee maker and French press stored in pantry.',
    );

    await user.click(screen.getByRole('button', { name: 'Extract Rules' }));

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Updates existing rule'))).toBe(true);
      expect(document.body.contains(screen.getByText('New rule'))).toBe(true);
    });

    // Approve & Merge both selected facts
    await user.click(screen.getByRole('button', { name: /Approve & Merge \(2\)/ }));

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('Live Operational Values'))).toBe(true);
      expect(document.body.contains(screen.getByText('Coffee Setup'))).toBe(true);
      expect(
        document.body.contains(
          screen.getByText('Two dedicated driveway spots available behind the house.'),
        ),
      ).toBe(true);
    });
  });

  it('supports PDF upload import path', async () => {
    const user = userEvent.setup();
    const store = createLocalCohostStore();
    render(<App store={store} initialView="import" />);

    // PDF Upload tab
    await user.click(screen.getByRole('tab', { name: 'PDF Upload' }));
    const fileInput = screen.getByLabelText(/Upload PDF Welcome Guide/i);
    const pdfFile = new File(
      ['Pool Hours: Community pool is open 8 AM to 9 PM daily.'],
      'Welcome_Guide.pdf',
      { type: 'application/pdf' },
    );
    await user.upload(fileInput, pdfFile);
    expect(document.body.contains(screen.getByText('Welcome_Guide.pdf'))).toBe(true);
  });

  it('manages push alerts, Gmail watch health display, sign-off settings, and deletable learned diffs in Account', async () => {
    const user = userEvent.setup();
    const store = createLocalCohostStore();
    const { container } = render(<App store={store} />);

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(document.body.contains(screen.getByText('Host Account & Preferences'))).toBe(true);
    expect(container.querySelector('select')).toBeNull();

    // Gmail Watch & Dual-Inbox Health visible
    expect(document.body.contains(screen.getByText('Host + Co-Host Active'))).toBe(true);

    // Toggle Android Push Alerts switch
    const pushSwitch = screen.getByRole('switch', { name: 'Enable Android Push Alerts' });
    expect(pushSwitch.getAttribute('aria-checked')).toBe('true');
    await user.click(pushSwitch);
    expect(pushSwitch.getAttribute('aria-checked')).toBe('false');

    // Change sign-off mode via custom SelectPopover and save
    await user.click(screen.getByRole('button', { name: 'Sign-off mode' }));
    await user.click(screen.getByRole('option', { name: /Individual Sign-Off/i }));
    const signOffTextInput = screen.getByLabelText('Default Sign-Off Text');
    await user.clear(signOffTextInput);
    await user.type(signOffTextInput, 'Thanks, Alex');
    await user.click(screen.getByRole('button', { name: 'Save Voice Settings' }));

    expect(store.getSnapshot().voiceProfile.signOffMode).toBe('individual');
    expect(store.getSnapshot().voiceProfile.signOffText).toBe('Thanks, Alex');

    // Delete one learned voice diff entry (2 / 15 -> 1 / 15)
    expect(document.body.contains(screen.getByText('2 / 15'))).toBe(true);
    const deleteBtn = screen.getByRole('button', {
      name: /Delete learned diff: Drop overly formal openers/i,
    });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(document.body.contains(screen.getByText('1 / 15'))).toBe(true);
    });
  });

  it('adds a first property from the empty state with Airbnb URL parsing, adds a second from PropertySwitcher, and edits listing match in House Details', async () => {
    const user = userEvent.setup();
    const seed = createSeedSnapshot();
    const store = createLocalCohostStore({
      ...seed,
      properties: [],
      rules: {},
      threads: {},
      messages: {},
      unmatchedEmails: [],
    });

    render(<App store={store} />);

    // Empty state renders Add your first property
    expect(document.body.contains(screen.getByText('Add your first property'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Add Property' }));

    const addDialog = screen.getByRole('dialog', { name: 'Add Property' });
    await user.type(within(addDialog).getByLabelText('Property Name'), 'Maple Loft');

    // Short /h/ link warns instead of producing a fake ID
    const urlInput = within(addDialog).getByLabelText('Airbnb Listing URL or ID');
    await user.type(urlInput, 'https://www.airbnb.com/h/maple-loft');
    expect(
      document.body.contains(
        within(addDialog).getByText(/Short share links \(\/h\/ or abnb\.me\) hide the numeric ID/i),
      ),
    ).toBe(true);

    // Replace with full Airbnb listing URL -> live Detected ID pill renders
    await user.clear(urlInput);
    await user.type(urlInput, 'https://www.airbnb.com/rooms/1048291048291048?guests=1');
    expect(
      document.body.contains(within(addDialog).getByText('Detected ID: 1048291048291048')),
    ).toBe(true);

    const payoutInput = within(addDialog).getByLabelText('Min Nightly Payout ($)');
    await user.clear(payoutInput);
    await user.type(payoutInput, '185');

    const cleaningInput = within(addDialog).getByLabelText('Cleaning Fee ($)');
    await user.clear(cleaningInput);
    await user.type(cleaningInput, '125');

    await user.click(within(addDialog).getByRole('button', { name: 'Save Property' }));

    await waitFor(() => {
      expect(store.getSnapshot().properties).toHaveLength(1);
    });
    const firstProperty = store.getSnapshot().properties[0];
    expect(firstProperty.code).toBe('A');
    expect(firstProperty.accentColor).toBe('#095C57');
    expect(firstProperty.airbnbListingIds).toEqual(['1048291048291048']);
    expect(firstProperty.titleAliases).toEqual([]);
    expect(firstProperty.pricing).toEqual({
      nightlyFloor: 185,
      cleaningFee: 125,
      localTaxPct: 14,
      hostServiceFeePct: 15.5,
    });

    // Clean property name renders without "Property A · " prefix
    expect(document.body.contains(screen.getByText('Maple Loft'))).toBe(true);
    expect(screen.queryByText(/Property A/)).toBeNull();

    // Add a second property via PropertySwitcher preserving comma in single listing title
    await user.click(screen.getByRole('button', { name: 'Switch property' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add Property' }));

    const secondDialog = screen.getByRole('dialog', { name: 'Add Property' });
    await user.type(within(secondDialog).getByLabelText('Property Name'), 'Harbor Retreat');
    await user.type(
      within(secondDialog).getByLabelText('Airbnb Listing URL or ID'),
      'https://www.airbnb.com/hosting/listings/editor/22334455/details',
    );
    await user.type(
      within(secondDialog).getByLabelText('Airbnb Listing Title (Optional)'),
      'Harbor Retreat, Heated Pool & Dock',
    );
    await user.click(within(secondDialog).getByRole('button', { name: 'Save Property' }));

    await waitFor(() => {
      expect(store.getSnapshot().properties).toHaveLength(2);
    });
    const secondProperty = store.getSnapshot().properties[1];
    expect(secondProperty.code).toBe('B');
    expect(secondProperty.accentColor).toBe('#8C4A00');
    expect(secondProperty.airbnbListingIds).toEqual(['22334455']);
    expect(secondProperty.titleAliases).toEqual(['Harbor Retreat, Heated Pool & Dock']);

    // Edit listing match from House Details while preserving existing tax/host fee
    await user.click(screen.getByRole('button', { name: 'House Details' }));
    expect(document.body.contains(screen.getByText('Airbnb Listing Match'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Edit Listing' }));

    const editDialog = screen.getByRole('dialog', { name: 'Edit Property' });
    const titleInput = within(editDialog).getByLabelText('Airbnb Listing Title (Optional)');
    await user.clear(titleInput);
    await user.type(titleInput, 'Harbor Retreat, Private Dock');
    await user.click(within(editDialog).getByRole('button', { name: 'Save Property' }));

    await waitFor(() => {
      const updated = store.getSnapshot().properties.find((p) => p.id === secondProperty.id);
      expect(updated?.titleAliases).toEqual(['Harbor Retreat, Private Dock']);
      expect(updated?.code).toBe('B');
      expect(updated?.pricing.localTaxPct).toBe(14);
      expect(updated?.pricing.hostServiceFeePct).toBe(15.5);
    });
  });
});
