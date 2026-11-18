import type { ReactNode } from 'react';

export const metadata = { title: 'bundle-mop fixture: dynamic-barrel' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
