'use client';

import { useState, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { makeStore } from '@/lib/store';

/** One Redux store per browser tab (created once, not per render). */
export default function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  return <Provider store={store}>{children}</Provider>;
}
