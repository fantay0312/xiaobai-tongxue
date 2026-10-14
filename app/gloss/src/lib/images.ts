/**
 * Pictures, made legible to Readability. Runs on the raw page before it.
 *
 * An image eval across 23 publishers (scripts/image-eval) showed the ways
 * article pictures were lost before they reached the reader:
 * - the address sits on <source> inside <picture>, with a bare <img> (Medium);
 * - attributes are React-cased (srcSet) or lazy (data-src), and the DOM
 *   parser reads attribute names case-sensitively (BBC, The Verge, Next.js);
 * - a grey placeholder sits beside the real picture and wins (BBC);
 * - the picture is buried in layout wrappers that Readability scores as page
 *   furniture and drops, taking the picture with them (The Verge, Nature, AP);
 * - maths is drawn as images, which became full-width figures (Wikipedia).
 * So each content picture is resolved to one real URL and rewrapped as a
 * plain <figure> with its caption, which Readability keeps in the flow;
 * formulas go back into the sentence as text. Pictures in promos, related
 * links, ads and page chrome are left alone.
 */

import { parseSrcset } from "./html-to-blocks";
import { texToText } from "./tex";

/** An attribute by name, whatever its case: the parser keeps "srcSet" as written. */
export function attrOf(el: Element, name: string): string | null {
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  const want = name.toLowerCase();
  for (const a of Array.from(el.attributes)) if (a.name.toLowerCase() === want) return a.value;
  return null;
}

// "1x1" only on its own: a filename like "photo_1641x1094.png" is a real picture.
const PLACEHOLDER = /^data:|placeholder|spacer|blank\.(gif|png)|transparent\.(gif|png)|(^|[^0-9])1x1([^0-9]|$)|pixel\.(gif|png)|lazy[-_]?load|loading\.(gif|svg)/i;
export const isPlaceholder = (url: string) => PLACEHOLDER.test(url);

/** Addresses that are never the article's own pictures: profile photos, emoji, icons. */
const NOT_A_PICTURE = /gravatar\.com|\/avatars?\/|profile_image|\/emoji\/|\/icons?\/|favicon/i;

/** Where pictures that are not part of the article live. */
const CHROME = "header, nav, footer, aside, form, [role=banner], [role=navigation], [role=contentinfo], [role=complementary]";
const NOT_ARTICLE = /related|recommend|promo|newsletter|subscribe|share|social|comment|sidebar|avatar|author|byline|advert|sponsor|teaser|carousel|gallery-nav|menu|breadcrumb|(^|[-_ ])ad([-_ ]|$)/i;

/** The largest candidate in a srcset, or null. */
function largest(srcset: string | null): string | null {
  if (!srcset) return null;
  const best = parseSrcset(srcset)
    .filter((c) => !isPlaceholder(c.url))
    .sort((a, b) => b.size - a.size)[0];
  return best?.url ?? null;
}

/** The real picture behind an <img>: srcset first, then the lazy-loading attributes, then src. */
function realSrc(img: Element): string | null {
  const fromSet = largest(attrOf(img, "srcset") ?? attrOf(img, "data-srcset") ?? attrOf(img, "data-lazy-srcset"));
  if (fromSet) return fromSet;
  for (const n of ["data-src", "data-original", "data-lazy-src", "data-hi-res-src", "data-url", "src"]) {
    const v = attrOf(img, n)?.trim();
    if (v && !isPlaceholder(v)) return v;
  }
  return null;
}

export function prepareImages(doc: Document, base: string) {
  // Maths first: a formula is part of its sentence, not a picture.
  for (const el of Array.from(doc.querySelectorAll(".mwe-math-element"))) {
    const tex = el.querySelector("img")?.getAttribute("alt");
    if (tex) el.replaceWith(doc.createTextNode(texToText(tex)));
  }
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const alt = img.getAttribute("alt") ?? "";
    if (/math/i.test(img.getAttribute("class") ?? "") && alt.startsWith("{\\displaystyle")) img.replaceWith(doc.createTextNode(texToText(alt)));
  }

  // <picture>: the <img> gets the best <source> when it has nothing of its own, then stands alone.
  for (const pic of Array.from(doc.querySelectorAll("picture"))) {
    const sources = Array.from(pic.querySelectorAll("source")).filter((s) => !/avif|jxl/i.test(s.getAttribute("type") ?? ""));
    // A source without a media query is the general one; otherwise the widest.
    const general = sources.find((s) => !s.getAttribute("media")) ?? sources[sources.length - 1];
    const fromSource = general ? largest(attrOf(general, "srcset")) : null;
    let img = pic.querySelector("img");
    if (!img && fromSource) img = doc.createElement("img");
    if (!img) continue;
    if (!realSrc(img) && fromSource) img.setAttribute("src", fromSource);
    pic.replaceWith(img);
  }

  // Placeholders and non-pictures go first: one left beside a real picture (Cloudflare's blurred
  // stand-in) would stop the climb to that picture's own wrapper below.
  const pictures: { img: Element; src: string }[] = [];
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const raw = realSrc(img);
    if (!raw) {
      img.remove();
      continue;
    }
    let src: string;
    try {
      src = new URL(raw, base).toString();
    } catch {
      img.remove();
      continue;
    }
    if (!/^https?:/i.test(src)) continue;
    if (NOT_A_PICTURE.test(src) || darkOnly(img, src)) {
      img.remove();
      continue;
    }
    pictures.push({ img, src });
  }

  const figures: Element[] = [];
  for (const { img, src } of pictures) {
    if (img.closest(CHROME) || hasJunkAncestor(img)) continue;
    const w = Number(attrOf(img, "width"));
    if (w && w < 200) continue;
    // A thumbnail that links to another page is a teaser, unless the publisher marked it a figure.
    const link = img.closest("a")?.getAttribute("href") ?? "";
    if (link && !img.closest("figure") && !/\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(link) && !link.startsWith("#")) continue;

    // The picture's own wrapper: the highest ancestor that holds just this picture and at most a caption.
    let wrap: Element = img;
    for (let k = 0; k < 6; k++) {
      const p = wrap.parentElement;
      if (!p || /^(BODY|ARTICLE|MAIN|SECTION|P|LI|TD|TH|BLOCKQUOTE)$/.test(p.tagName.toUpperCase())) break;
      if (p.querySelectorAll("img").length !== 1 || (p.textContent ?? "").trim().length > 300) break;
      wrap = p;
    }
    // Inline images in running text (emoji, icons) stay where they are.
    if (wrap === img && img.parentElement && /^(P|LI|TD|TH|SPAN|A)$/.test(img.parentElement.tagName.toUpperCase()) && (img.parentElement.textContent ?? "").trim()) continue;

    const capEl = wrap.querySelector("figcaption");
    const caption = (capEl?.textContent ?? (wrap !== img && wrap.tagName.toUpperCase() !== "FIGURE" ? wrap.textContent : "") ?? "").replace(/\s+/g, " ").trim();
    const fig = doc.createElement("figure");
    const clean = doc.createElement("img");
    clean.setAttribute("src", src);
    if (img.getAttribute("alt")) clean.setAttribute("alt", img.getAttribute("alt")!);
    fig.appendChild(clean);
    if (caption && caption.length <= 300 && caption !== img.getAttribute("alt")) {
      const fc = doc.createElement("figcaption");
      fc.textContent = caption;
      fig.appendChild(fc);
    }
    wrap.replaceWith(fig);
    figures.push(fig);
  }

  // A gallery or carousel holds its figures in wrappers with no text of their own, and Readability
  // drops any block with more pictures than paragraphs (OpenAI, claude.dev). The figures join the flow.
  for (const fig of figures) {
    for (let p = fig.parentElement; p && !STOP.test(p.tagName.toUpperCase()) && onlyFigures(p); ) {
      const up = p.parentElement;
      p.replaceWith(...Array.from(p.childNodes));
      p = up;
    }
  }
}

/** Where a picture's own wrapper ends and the article's structure begins. */
const STOP = /^(BODY|ARTICLE|MAIN|SECTION|P|LI|TD|TH|BLOCKQUOTE|FIGURE)$/;

/** An element holding figures and nothing else: no text, no other elements. */
function onlyFigures(el: Element): boolean {
  let n = 0;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1) {
      if ((c as Element).tagName.toUpperCase() !== "FIGURE") return false;
      n++;
    } else if (c.nodeType === 3 && (c.textContent ?? "").trim()) return false;
  }
  return n > 0;
}

/** Named classes for the dark-theme copy of a picture: "theme-image-dark", "dark-only", "only-dark". */
const DARK_CLASS = /^((theme-)?(image|img)-dark|dark-(only|mode-only|image|img)|(only|show)-dark)$/i;

/**
 * The dark-theme copy of a picture that also comes in light (Gimlet, Tailwind's
 * "hidden dark:block", GitHub's "#gh-dark-mode-only"). The reader shows each once.
 */
function darkOnly(img: Element, src: string): boolean {
  if (/#gh-dark-mode-only$/.test(src)) return true;
  for (const el of [img, img.parentElement]) {
    const tokens = (el?.getAttribute("class") ?? "").split(/\s+/);
    if (tokens.some((t) => DARK_CLASS.test(t))) return true;
    if (tokens.includes("hidden") && tokens.some((t) => /^dark:(block|inline|inline-block|flex|grid)$/.test(t))) return true;
  }
  return false;
}

function hasJunkAncestor(el: Element): boolean {
  for (let e = el.parentElement, k = 0; e && k < 8; e = e.parentElement, k++) {
    const sig = `${e.getAttribute("class") ?? ""} ${e.getAttribute("id") ?? ""} ${e.getAttribute("data-testid") ?? ""}`;
    if (NOT_ARTICLE.test(sig)) return true;
  }
  return false;
}

/**
 * A picture's file name without size or extension, decoded: the same photo
 * behind a CDN resize, a crop for sharing and the full original. Null when
 * too short to tell pictures apart.
 */
export function imageStem(src: string): string | null {
  try {
    const file = decodeURIComponent(new URL(src).pathname).split("/").pop() ?? "";
    const stem = file.replace(/\.\w+$/, "").replace(/-\d+x\d+$/, "");
    return stem.length >= 6 ? stem : null;
  } catch {
    return null;
  }
}

/**
 * The article's lead picture, from its share image (og:image), when the page
 * itself shows that picture. Publishers put the lead photo above the article
 * body, where Readability does not look (The Verge, Wired, AP); a share image
 * the page never shows is a card made for social media, and is left out.
 */
export function leadImage(doc: Document, base: string): string | null {
  const meta = doc
    .querySelector('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]')
    ?.getAttribute("content");
  if (!meta) return null;
  let url: URL;
  try {
    url = new URL(meta, base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || NOT_A_PICTURE.test(url.href) || /logo|default|placeholder/i.test(url.pathname)) return null;
  const stem = imageStem(url.toString());
  if (!stem) return null;
  const shown = Array.from(doc.querySelectorAll("img, source")).some((el) =>
    ["src", "srcset", "data-src"].some((n) => {
      const v = attrOf(el, n);
      if (!v) return false;
      try {
        return decodeURIComponent(v).includes(stem);
      } catch {
        return v.includes(stem);
      }
    })
  );
  return shown ? url.toString() : null;
}
