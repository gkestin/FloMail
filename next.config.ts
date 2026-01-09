import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  
  // Disable image optimization for simpler deployment (can enable later with proper config)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
