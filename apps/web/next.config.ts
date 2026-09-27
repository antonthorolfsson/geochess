import type { NextConfig } from 'next';

/** Where the game server listens. The web app proxies /api to it so cookies stay first-party. */
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  transpilePackages: ['@empire/rules'],
  // Let phones on the local network load the dev server (e.g. http://192.168.1.20:3000).
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*', '*.local'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        // Country data is versioned by path, so it never changes in place.
        source: '/datasets/:version/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
