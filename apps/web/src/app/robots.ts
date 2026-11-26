import type { MetadataRoute } from "next"
import { robotsRules } from "@/lib/robots"

/** /robots.txt — everything open but the private zones, and where the sitemap is (lib/robots.ts). */
export default function robots(): MetadataRoute.Robots {
  return robotsRules()
}
