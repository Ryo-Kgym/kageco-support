import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  logging: { serverFunctions: false, incomingRequests: { ignore: [/^\/freee\/callback(?:\?|$)/] } },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/freee/callback",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    }];
  },
};

export default config;
