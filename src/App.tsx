import { useSyncExternalStore } from 'react';
import { getHavenStore, type HavenStore } from './services/havenStore.ts';

export interface AppProps {
  store?: HavenStore;
}

export function App({ store }: AppProps) {
  const activeStore = store ?? getHavenStore();
  const snapshot = useSyncExternalStore(activeStore.subscribe, activeStore.getSnapshot);

  return (
    <div className="min-h-screen max-w-[420px] mx-auto bg-light-surface border-x border-light-outline-variant p-6 flex flex-col gap-3">
      <h1 className="font-headline text-headline-md text-light-on-surface">Haven Co-Host</h1>
      <p className="text-body-md text-light-secondary">
        {snapshot.properties.length} properties ready in {activeStore.mode} mode.
      </p>
    </div>
  );
}
