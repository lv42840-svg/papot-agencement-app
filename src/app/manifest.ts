import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PAPOT AGENCEMENT",
    short_name: "PAPOT",
    description: "Application interne PAPOT AGENCEMENT",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4fc",
    theme_color: "#7666d6",
    icons: [{ src: "/papot-icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
