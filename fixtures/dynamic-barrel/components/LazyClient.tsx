'use client';

import dynamic from 'next/dynamic';
// Barrel import: only Badge is used; Unused is re-exported by the barrel and should be tree-shaken.
import { Badge } from './ui';

// Lazy: moment arrives only after this dynamic import resolves, so it is NOT first-load JS.
const Heavy = dynamic(() => import('./ui/Heavy'), { ssr: false });

export default function LazyClient() {
  return (
    <section>
      <Badge text="lazy" />
      <Heavy />
    </section>
  );
}
