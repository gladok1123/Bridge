/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // никаких внешних доменов для картинок — всё рисуем сами
  images: { remotePatterns: [] },
  async headers() {
    return [
      { source: '/api/sig', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
    ];
  },
};

export default nextConfig;
