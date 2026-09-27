import type { Metadata, Viewport } from 'next';
import { Saira_Stencil, Sofia_Sans_Condensed } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

const sofia = Sofia_Sans_Condensed({ subsets: ['latin', 'latin-ext'], variable: '--font-sofia', display: 'swap' });
// Next has no fallback metrics for this face; it's only used for short headings anyway.
const stencil = Saira_Stencil({
  subsets: ['latin'],
  variable: '--font-stencil-face',
  display: 'swap',
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: 'Empire Chess', template: '%s · Empire Chess' },
  description: 'Claim countries, declare wars, and settle them over the board.',
  applicationName: 'Empire Chess',
  appleWebApp: { capable: true, title: 'Empire Chess', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#1f2428',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sofia.variable} ${stencil.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
