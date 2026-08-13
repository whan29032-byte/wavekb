import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@wavekb/domain", "@wavekb/ui"],
  poweredByHeader: false,
  deploymentId: process.env.DEPLOYMENT_VERSION,
};

export default nextConfig;
