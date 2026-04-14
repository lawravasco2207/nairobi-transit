import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a standalone server bundle for Docker/DigitalOcean deployment
  output: "standalone",

  /**
   * Server-side proxy rewrites.
   *
   * INTERNAL_API_URL is injected at runtime by DO App Platform via the
   * ${api.PRIVATE_URL} component binding (see .do/app.yaml).
   * Locally it falls back to http://localhost:8080 so `next dev` works
   * without any extra setup.
   *
   * This proxy layer means the frontend container is the single public
   * entry-point for all HTTP traffic.  The Rust API service only needs
   * the one direct ingress rule kept for WebSocket connections
   * (/api/conductor/ws) — everything else reaches it through here.
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
