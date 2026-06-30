import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      //  With dynamic: 30, if a user visits Page A, goes to Page B, then goes back to Page A within 30 seconds — it serves the cached version instantly instead of making another server request.
      dynamic: 30,
    },
  },
  serverExternalPackages: ["@node-rs/argon2"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ufs.sh" }, // v7 — the one you need
      { protocol: "https", hostname: "utfs.io" }, // older URLs, optional
    ],
  },
};

export default nextConfig;
