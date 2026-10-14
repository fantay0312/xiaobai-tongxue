/** The opening of a text, as plain paragraphs: what the classifier reads. Shared by browser and server. */
export const EXCERPT_CHARS = 2400;

export function excerptOf(blocks: { type: string; runs: { text: string }[] }[]): string {
  let out = "";
  for (const b of blocks) {
    if (b.type === "figure" || b.type === "table") continue;
    out += `${b.runs.map((r) => r.text).join("")}\n`;
    if (out.length > EXCERPT_CHARS) break;
  }
  return out.slice(0, EXCERPT_CHARS);
}
