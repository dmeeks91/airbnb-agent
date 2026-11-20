// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { createSeedSnapshot } from '../../data/seedData.ts';
import { createLocalHavenStore } from '../../services/havenStore.ts';

afterEach(() => {
  cleanup();
});

describe('App Firebase Auth allowlist gate and missing-thread recovery', () => {
  it('shows Sign in with Google when live auth is enabled and no user is signed in', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn(async () => undefined);
    const store = createLocalHavenStore();

    render(
      <App
        store={store}
        authGate={{
          enabled: true,
          ready: true,
          user: null,
          onSignIn,
        }}
      />,
    );

    const signInBtn = screen.getByRole('button', { name: /Sign in with Google/i });
    expect(document.body.contains(signInBtn)).toBe(true);
    await user.click(signInBtn);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('locks out unverified Google accounts and non-allowlisted emails (fail-closed)', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn(async () => undefined);
    const store = createLocalHavenStore();

    // Case 1: unverified email even if email string matches allowlist
    const { rerender } = render(
      <App
        store={store}
        authGate={{
          enabled: true,
          ready: true,
          user: {
            uid: 'u-unverified',
            email: 'alex@example.com',
            displayName: 'Alex',
            emailVerified: false,
          },
          onSignOut,
        }}
      />,
    );

    expect(document.body.contains(screen.getByText('Access Restricted'))).toBe(true);
    expect(document.body.contains(screen.getByText(/requires a verified Google email/i))).toBe(true);
    expect(screen.queryByText('Marcus L. (Nov 21 - 25)')).toBeNull();

    // Case 2: verified email NOT on allowlist
    rerender(
      <App
        store={store}
        authGate={{
          enabled: true,
          ready: true,
          user: {
            uid: 'u-outsider',
            email: 'stranger@other.com',
            displayName: 'Stranger',
            emailVerified: true,
          },
          onSignOut,
        }}
      />,
    );

    expect(document.body.contains(screen.getByText('Access Restricted'))).toBe(true);
    expect(document.body.contains(screen.getByText(/not on the verified host allowlist/i))).toBe(true);

    // Case 3: fail-closed when allowlist is empty
    const emptyAllowlistStore = createLocalHavenStore({
      ...createSeedSnapshot(),
      allowedEmails: [],
    });
    rerender(
      <App
        store={emptyAllowlistStore}
        authGate={{
          enabled: true,
          ready: true,
          user: {
            uid: 'u-any',
            email: 'alex@example.com',
            displayName: 'Alex',
            emailVerified: true,
          },
          onSignOut,
        }}
      />,
    );

    expect(document.body.contains(screen.getByText('Access Restricted'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);

    // Case 4: allowlisted + verified user unlocks queue
    rerender(
      <App
        store={store}
        authGate={{
          enabled: true,
          ready: true,
          user: {
            uid: 'u-alex',
            email: 'alex@example.com',
            displayName: 'Alex',
            emailVerified: true,
          },
          onSignOut,
        }}
      />,
    );

    expect(screen.queryByText('Access Restricted')).toBeNull();
    expect(document.body.contains(screen.getByText('Marcus L. (Nov 21 - 25)'))).toBe(true);
  });

  it('renders a clean recovery screen instead of a blank page if deep-linked to an unavailable thread', async () => {
    const user = userEvent.setup();
    const store = createLocalHavenStore();

    render(
      <App
        store={store}
        initialPropertyId="prop-coastal-loft"
        initialView="dialogue"
        initialThreadId="thread-does-not-exist"
      />,
    );

    expect(document.body.contains(screen.getByText('Conversation unavailable'))).toBe(true);
    await user.click(screen.getByRole('button', { name: /Back to Messages/i }));
    expect(document.body.contains(screen.getByText('Marcus L. (Nov 21 - 25)'))).toBe(true);
  });
});
