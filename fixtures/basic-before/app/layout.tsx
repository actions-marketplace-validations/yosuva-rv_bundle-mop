import type { ReactNode } from 'react';

export const metadata = { title: 'bundle-mop fixture: basic-before' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
