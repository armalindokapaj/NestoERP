import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge sits on top of the sidebar footer; the build output
  // and error overlay are unaffected.
  devIndicators: false,
};

export default nextConfig;
