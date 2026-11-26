import type { NextConfig } from "next";

const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  logging: { serverFunctions: false, incomingRequests: { ignore: [/^\/freee\/callback(?:\?|$)/] } },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/freee/callback",
      // Keep OAuth query parameters out of referrers while retaining Origin for the Server Action POST.
      headers: [{ key: "Referrer-Policy", value: "strict-origin" }],
    }];
  },
};

export default config;
