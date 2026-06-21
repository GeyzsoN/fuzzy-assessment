import type { ReactNode } from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Mini Outreach Sequencer',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <nav
          style={{
            display: 'flex',
            gap: 16,
            padding: '12px 24px',
            borderBottom: '1px solid #eee',
          }}
        >
          <Link href="/">Home</Link>
          <Link href="/contacts">Contacts</Link>
        </nav>
        <main style={{ padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
