import type { NextConfig } from "next";

const FASTAPI_INTERNAL_URL = process.env.FASTAPI_INTERNAL_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${FASTAPI_INTERNAL_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
