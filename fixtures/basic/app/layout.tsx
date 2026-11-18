import type { ReactNode } from 'react';

export const metadata = { title: 'bundle-mop fixture: basic' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
