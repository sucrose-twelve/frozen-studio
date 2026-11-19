import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  agentRules: false,

  cacheComponents: true,

  /**
   * The studio's submit bar sits in the bottom left corner, where the indicator would cover it.
   */
  devIndicators: {
    position: "bottom-right"
  },

  experimental: {
    /**
     * `bun run build` deletes `.next` first, so a Turbopack build cache would never be read back.
     */
    turbopackFileSystemCacheForBuild: false
  },

  httpAgentOptions: {
    keepAlive: false
  },

  /**
   * Thumbnails go through the image optimizer, which fetches the full file from `/api/media/<id>` and
   * serves a resized copy. The canvas shows the original untouched.
   */
  images: {
    qualities: [50, 75, 100],
    localPatterns: [{ pathname: "/api/media/**", search: "" }]
  },

  logging: {
    fetches: {
      fullUrl: true,
      hmrRefreshes: true
    },
    incomingRequests: {
      // Polled or streamed constantly; they would bury everything else in the log
      ignore: [/^\/api\/events/, /^\/api\/media\//, /^\/_next\/image/]
    }
  },

  partialPrefetching: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false
}

export default nextConfig
