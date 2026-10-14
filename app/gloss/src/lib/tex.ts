/**
 * Maths written as TeX, as plain readable text. Formulas reach Gloss as TeX
 * from two places: Wikipedia's formula images (their alt text) and page
 * readers that write maths between $ signs. The reader shows plain text, so
 * "\frac{L}{D}" becomes "(L/D)" and "\Delta p" becomes "Δp": enough to read, not to typeset.
 */

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ",
  omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // Operators carry their own spaces, so "56\times56" and "56 \times 56" both read "56 × 56".
  cdot: " · ", times: " × ", pm: " ± ", leq: " ≤ ", geq: " ≥ ", neq: " ≠ ", approx: " ≈ ", infty: "∞", partial: "∂", nabla: "∇", sum: "∑", int: "∫", to: " → ",
  in: " ∈ ", notin: " ∉ ", sim: " ~ ", propto: " ∝ ", cdots: "…", ldots: "…", dots: "…", prime: "′", top: "ᵀ", mid: "|", prod: "∏", sqrt: "√", quad: " ", qquad: " ",
  rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", forall: "∀", exists: "∃", cup: "∪", cap: "∩", subset: "⊂", odot: "⊙", oplus: "⊕", ell: "ℓ",
  simeq: " ≃ ", equiv: " ≡ ", gets: " ← ", longrightarrow: " ⟶ ", mapsto: " ↦ ", ast: "∗", star: "⋆", circ: "∘", emptyset: "∅",
  langle: "⟨", rangle: "⟩", vert: "|", Vert: "‖", lbrace: "{", rbrace: "}", log: "log ", exp: "exp ", max: "max ", min: "min ",
};
/** Accents, as the combining mark they put over a letter. */
const ACCENT: Record<string, string> = { tilde: "\u0303", widetilde: "\u0303", hat: "\u0302", widehat: "\u0302", bar: "\u0304", overline: "\u0305", vec: "\u20d7", dot: "\u0307" };
const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺" };

export function texToText(tex: string): string {
  // Wikipedia wraps every formula in {\displaystyle ...}; only then is the last brace the wrapper's.
  let s = /^\{\\displaystyle/.test(tex) ? tex.replace(/^\{\\displaystyle\s*/, "").replace(/\}\s*$/, "") : tex;
  // Escaped characters are themselves: set aside now, so no rule below reads them as TeX, and put back last.
  s = s.replace(/\\([{}%&#_$])/g, (_, c: string) => String.fromCharCode(0xe100 + c.charCodeAt(0)));
  // Arrays (a bracketed stack of layers, a matrix): rows become "; ", columns spaces, and the frame goes.
  s = s
    .replace(/\\begin\{[a-z*]+\}(\{[^{}]*\})?|\\end\{[a-z*]+\}/g, "")
    .replace(/\\\\/g, "; ")
    .replace(/&/g, " ");
  // Innermost first: powers and indices, so a fraction around them has no braces left inside.
  s = s
    .replace(/\^\{?([0-9+-]+)\}?/g, (_, d: string) => [...d].map((c) => SUPER[c] ?? c).join(""))
    .replace(/([_^])\{([^{}]*)\}/g, "$1$2");
  // Then from the inside out, again and again, so a root inside a fraction inside a root all unwind.
  for (let k = 0; k < 6; k++)
    s = s
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
      .replace(/\\(?:mathrm|text|textrm|textbf|textit|operatorname|mathit|mathbf|mathcal|mathbb|mathsf|boldsymbol|bm)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\(tilde|widetilde|hat|widehat|bar|overline|vec|dot)\s*\{([^{}]*)\}/g, (_, a: string, x: string) => x + ACCENT[a])
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1/$2)");
  s = s
    .replace(/\\(tilde|hat|bar|vec|dot)\s+([A-Za-z])/g, (_, a: string, x: string) => x + ACCENT[a])
    .replace(/\\tag\s*\{([^{}]*)\}/g, " ($1)")
    .replace(/\\left|\\right/g, "")
    .replace(/\\[,;:! ]/g, " ")
    // A command name ends at the next space, which TeX swallows: "\\Delta p" is "Δp".
    .replace(/\\([A-Za-z]+) ?/g, (_, w: string) => GREEK[w] ?? w)
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([;,)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/[\ue100-\ue17f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe100))
    .trim();
  return s;
}
