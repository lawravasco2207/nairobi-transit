import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a standalone server bundle for Docker/DigitalOcean deployment
  output: "standalone",
};

export default nextConfig;
