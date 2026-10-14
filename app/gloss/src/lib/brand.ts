/** Every outbound URL in one place. */
export const BRAND = {
  name: "阅读",
  togetherUrl: "https://www.together.ai",
  keysUrl: "https://api.together.ai/settings/api-keys",
  modelsUrl: "https://www.together.ai/models",
} as const;


/** The social card. The version busts the caches of X, Slack and LinkedIn, which keep a card image by its URL. */
export const OG_IMAGE = { url: "/og.jpg?v=3", width: 1200, height: 630, alt: "Gloss: highlight any line, ask it anything. Powered by Together AI." };

/** The public origin, for canonical, sitemap and social card URLs. */
export const SITE_URL = typeof location !== "undefined" ? location.origin : "";
