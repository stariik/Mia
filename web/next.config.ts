import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow LAN dev access from the phone — router rotates the laptop's IP
  // periodically so we accept the entire /24 instead of a single address.
  allowedDevOrigins: ["192.168.68.*", "192.168.1.*", "192.168.0.*"],
};

export default nextConfig;
