/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    proxyTimeout: 600000, // Tell Next.js to wait up to 2 minutes (120,000 ms)
  },
  async rewrites() {
    // If building for production (Docker), bake in the Docker network name. 
    // Otherwise, use localhost for local development.
    const backendUrl = process.env.NODE_ENV === 'production' 
      ? 'http://backend:8000' 
      : 'http://localhost:8000';

    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig