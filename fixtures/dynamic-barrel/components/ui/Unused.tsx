'use client';

import { useEffect } from 'react';

// Never imported directly; only re-exported by ./index.ts. Its body is deliberately
// large so that, if tree-shaking ever stops working, the size jump is obvious.
export function Unused() {
  useEffect(() => {
    console.log('unused component body '.repeat(200));
  }, []);
  return null;
}
