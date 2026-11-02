import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the API's 45-second AI timeout (and 50-second shared wait)
  // to return an error before the frontend proxy closes the connection.
  experimental: { proxyTimeout: 60_000 },
  async rewrites() {
    const apiUrl = (process.env.API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
