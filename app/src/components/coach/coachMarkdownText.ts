export function markdownToPlainText(text: string): string {
  const withoutSyntax = text
    .replace(/```[\w.+-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:\|?\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/!\[([^\]]*)]\((?:[^()\s]|\([^)\s]*\))+\)/g, '图片：$1')
    .replace(/\[([^\]]+)]\((?:[^()\s]|\([^)\s]*\))+\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(?<!\w)([*_])([^*_\n]+)\1(?!\w)/g, '$2');
  return withoutSyntax
    .split('\n')
    .map((line) => line.includes('|')
      ? line.replace(/^\s*\||\|\s*$/g, '').replace(/\s*\|\s*/g, '，').trim()
      : line)
    .filter((line) => line.trim())
    .join('\n');
}
