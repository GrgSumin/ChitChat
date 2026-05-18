import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      //  With dynamic: 30, if a user visits Page A, goes to Page B, then goes back to Page A within 30 seconds — it serves the cached version instantly instead of making another server request.
      dynamic: 30,
    },
  },
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
