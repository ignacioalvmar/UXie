import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@uxie/core", "@uxie/character"],
  poweredByHeader: false,
};

export default config;
