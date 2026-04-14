import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a standalone server bundle for Docker/DigitalOcean deployment
  output: "standalone",

  /**
   * Server-side proxy rewrites — used for LOCAL DEVELOPMENT only.
   *
   * In production (DO App Platform), the ingress routes /api/* and /pay/*
   * directly to the Rust API service, bypassing Next.js entirely.
   * These rewrites do NOT work in production because rewrites() is
   * evaluated at build time and INTERNAL_API_URL is a runtime-only
   * variable (DO component binding ${api.PRIVATE_URL}).
   *
   * Locally, INTERNAL_API_URL is unset so the fallback
   * http://localhost:8080 correctly points to `cargo run`.
   */
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL ?? "http://localhost:8080";
    return [
      // All REST API calls
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      // Passenger pay page served as raw HTML by the Rust handler
      {
        source: "/pay/:path*",
        destination: `${apiUrl}/pay/:path*`,
      },
      // Health endpoint (useful for smoke-testing the full stack)
      {
        source: "/health",
        destination: `${apiUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
