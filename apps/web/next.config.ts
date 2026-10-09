import type { NextConfig } from "next";
import readingImages from "./src/lib/knowledge/generated-reading-images.json";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@wavekb/domain", "@wavekb/knowledge", "@wavekb/ui"],
  poweredByHeader: false,
  deploymentId: process.env.DEPLOYMENT_VERSION,
  // Exact content-addressed files only: no permanent caching of mutable
  // originals, arbitrary uploads, or nonexistent hash-shaped URLs.
  headers: async () => [...new Set(Object.values(readingImages))].map((source) => ({
    source,
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  })),
};

export default nextConfig;
