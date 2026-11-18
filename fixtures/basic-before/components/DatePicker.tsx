'use client';

// "Before" state of fixtures/basic: native Intl, no date library.
// fixtures/basic is the "after" (PR) state that swaps this for moment.
import { useState } from 'react';

const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export default function DatePicker() {
  const [date, setDate] = useState(() => new Date());
  return (
    <div>
      <p>Selected: {fmt.format(date)}</p>
      <button type="button" onClick={() => setDate((d) => new Date(d.getTime() + 86_400_000))}>
        Next day
      </button>
    </div>
  );
}
