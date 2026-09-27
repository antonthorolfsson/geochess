import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Empire Chess',
    short_name: 'Empire Chess',
    description: 'Claim countries, declare wars, and settle them over the board.',
    start_url: '/',
    display: 'standalone',
    background_color: '#1f2428',
    theme_color: '#1f2428',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
