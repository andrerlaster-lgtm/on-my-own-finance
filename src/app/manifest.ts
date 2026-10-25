import type { MetadataRoute } from "next";

/** Lets "Add to Home Screen" on a phone open the app like an app. Names and colors only, no data. */
export default function manifest(): MetadataRoute.Manifest {
  return { name: "On My Own Finance", short_name: "My Finance", description: "Private business finances", start_url: "/", display: "standalone", background_color: "#faf6ee", theme_color: "#faf6ee", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] };
}
