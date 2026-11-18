'use client';

// Intentionally heavy: full moment import (with locales) pulled into the client bundle.
import moment from 'moment';
import { useState } from 'react';

export default function DatePicker() {
  const [date, setDate] = useState(() => moment());
  return (
    <div>
      <p>Selected: {date.format('dddd, MMMM Do YYYY')}</p>
      <button type="button" onClick={() => setDate((d) => d.clone().add(1, 'day'))}>
        Next day
      </button>
    </div>
  );
}
