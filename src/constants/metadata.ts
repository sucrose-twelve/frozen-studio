import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: {
    default: "Frozen Studio • Local AI media generator",
    template: "%s • Frozen Studio"
  },
  description:
    "Generate images, video and voice on this machine. A form-based studio on top of ComfyUI.",
  robots: { index: false, follow: false },
  icons: [{ rel: "icon", url: "/static/favicon.svg", type: "image/svg+xml" }]
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#131b2b"
}
