// Native App Router manifest file convention - Next.js auto-generates and
// auto-links this (no need to hand-place a public/manifest.json + wire
// metadata.manifest). See node_modules/next/dist/docs/01-app/03-api-
// reference/03-file-conventions/01-metadata/manifest.md.
export default function manifest() {
  return {
    name: "Southern Traders POS",
    short_name: "ST POS",
    description: "Retail POS and Khata Management",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    scope: "/",
    background_color: "#fdfbf7",
    theme_color: "#c9793a",
    icons: [
      { src: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
