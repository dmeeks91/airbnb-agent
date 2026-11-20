// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { BottomSheet } from '../BottomSheet.tsx';
import { DatePickerPopover } from '../DatePickerPopover.tsx';
import { SearchInput } from '../SearchInput.tsx';
import { SelectPopover, type SelectOption } from '../SelectPopover.tsx';

afterEach(() => {
  cleanup();
});

describe('UI Primitives', () => {
  it('SearchInput updates value and clears with the custom clear trigger or Escape', async () => {
    const user = userEvent.setup();

    function Wrapper() {
      const [val, setVal] = useState('');
      return (
        <SearchInput
          value={val}
          onChange={setVal}
          placeholder="Search guests..."
          rightSlot={<button type="button">Filter</button>}
        />
      );
    }

    render(<Wrapper />);
    const input = screen.getByRole<HTMLInputElement>('searchbox', { name: 'Search guests...' });
    await user.type(input, 'Marcus');
    expect(input.value).toBe('Marcus');

    const clearBtn = screen.getByRole('button', { name: 'Clear search' });
    expect(document.body.contains(clearBtn)).toBe(true);
    await user.click(clearBtn);
    expect(input.value).toBe('');

    await user.type(input, 'Wi-Fi{Escape}');
    expect(input.value).toBe('');
  });

  it('SelectPopover supports keyboard navigation, search filtering (> 6 options), and selection without native <select>', async () => {
    const user = userEvent.setup();
    const options: SelectOption[] = [
      { value: 'a', label: 'Access & Arrival', swatchColor: '#095C57' },
      { value: 'b', label: 'Timings & Rates', swatchColor: '#8C4A00' },
      { value: 'c', label: 'Amenities & Rules', swatchColor: '#7F2A44' },
      { value: 'd', label: 'Parking', description: 'Driveway and street rules' },
      { value: 'e', label: 'Pets', badge: 'Policy' },
      { value: 'f', label: 'Trash & Recycling' },
      { value: 'g', label: 'Emergency Vendors' },
    ];

    const onChange = vi.fn();

    function Wrapper() {
      const [val, setVal] = useState('a');
      return (
        <SelectPopover
          label="Category"
          value={val}
          options={options}
          onChange={(next) => {
            setVal(next);
            onChange(next);
          }}
        />
      );
    }

    const { container } = render(<Wrapper />);
    expect(container.querySelector('select')).toBeNull();

    const trigger = screen.getByRole('button', { name: 'Category' });
    trigger.focus();
    await user.keyboard('{Enter}');

    const listbox = screen.getByRole('listbox', { name: 'Category' });
    expect(document.body.contains(listbox)).toBe(true);

    const filterInput = screen.getByRole('searchbox', { name: 'Filter options' });
    await user.type(filterInput, 'Vendors');
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('g');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('DatePickerPopover selects a quick preset and clears the value without native <input type="date">', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Wrapper() {
      const [val, setVal] = useState<string | null>(null);
      return (
        <DatePickerPopover
          label="Expiration date"
          value={val}
          onChange={(next) => {
            setVal(next);
            onChange(next);
          }}
        />
      );
    }

    const { container } = render(<Wrapper />);
    expect(container.querySelector('input[type="date"]')).toBeNull();

    const trigger = screen.getByRole('button', { name: 'Expiration date' });
    await user.click(trigger);

    const preset = screen.getByRole('button', { name: 'In 7 days' });
    await user.click(preset);

    expect(onChange).toHaveBeenCalledTimes(1);
    const chosenDate = onChange.mock.calls[0]?.[0];
    expect(typeof chosenDate).toBe('string');
    expect(chosenDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const clearBtn = screen.getByRole('button', { name: 'Clear expiration date' });
    await user.click(clearBtn);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('BottomSheet renders dialog when open and closes on Escape or close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <BottomSheet isOpen={true} title="Rule Details" onClose={onClose}>
        <p>Sheet content</p>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Rule Details' });
    expect(document.body.contains(dialog)).toBe(true);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close sheet' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('pressing Escape inside a SelectPopover nested in BottomSheet closes only the popover, not the sheet', async () => {
    const user = userEvent.setup();
    const onCloseSheet = vi.fn();

    render(
      <BottomSheet isOpen={true} title="Rule Details" onClose={onCloseSheet}>
        <SelectPopover
          label="Nested Category"
          value="a"
          options={[
            { value: 'a', label: 'Access & Arrival' },
            { value: 'b', label: 'Timings & Rates' },
          ]}
          onChange={() => undefined}
        />
      </BottomSheet>,
    );

    await user.click(screen.getByRole('button', { name: 'Nested Category' }));
    expect(document.body.contains(screen.getByRole('listbox'))).toBe(true);

    // First Escape closes only the SelectPopover
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onCloseSheet).not.toHaveBeenCalled();

    // Second Escape closes the BottomSheet
    await user.keyboard('{Escape}');
    expect(onCloseSheet).toHaveBeenCalledTimes(1);
  });
});
