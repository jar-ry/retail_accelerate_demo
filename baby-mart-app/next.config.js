const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // The Battlecards and Negotiation Brief pages became one Supplier Meeting page.
  async redirects() {
    return [
      { source: '/battlecards', destination: '/meeting', permanent: false },
      { source: '/negotiate', destination: '/meeting', permanent: false },
      { source: '/brand/:name/battlecard', destination: '/meeting/:name', permanent: false },
    ];
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.join(__dirname, 'src');
    return config;
  },
};

module.exports = nextConfig;
