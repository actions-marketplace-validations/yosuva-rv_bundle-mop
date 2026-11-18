'use client';

import { useState } from 'react';
import DatePicker from './DatePicker';

export default function DashboardClient() {
  const [count, setCount] = useState(0);
  return (
    <section>
      <DatePicker />
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Clicked {count} times
      </button>
    </section>
  );
}
