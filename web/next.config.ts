import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship only the files the server actually needs (see Dockerfile). Without
  // this the production image has to carry all of node_modules.
  output: "standalone",

  // Allow LAN dev access from the phone — router rotates the laptop's IP
  // periodically so we accept the entire /24 instead of a single address.
  allowedDevOrigins: ["192.168.68.*", "192.168.1.*", "192.168.0.*"],
};

export default nextConfig;
