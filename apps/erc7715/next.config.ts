import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    SESSION_ACCOUNT_ADDRESS: process.env.SESSION_ACCOUNT_ADDRESS ?? "",
    TOKEN_ADDRESS: process.env.TOKEN_ADDRESS ?? "",
  },
};

export default nextConfig;
