// Underscores inside identifiers/formulas must not consume text as Markdown emphasis.
export const INLINE_MARKDOWN_RE = /(!\[[^\]\n]*]\((?:[^()\s]|\([^)\s]*\))+\)|\[[^\]\n]+]\((?:[^()\s]|\([^)\s]*\))+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|(?<!\w)_[^_\n]+_(?!\w))/g;
