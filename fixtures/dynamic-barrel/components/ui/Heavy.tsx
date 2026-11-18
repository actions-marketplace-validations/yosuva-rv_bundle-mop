'use client';

import moment from 'moment';

export default function Heavy() {
  return <p>{moment().format('LLLL')}</p>;
}
