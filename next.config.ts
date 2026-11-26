import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async headers() {
    return [{
      source: "/freee/callback",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }];
  },
};

export default config;
