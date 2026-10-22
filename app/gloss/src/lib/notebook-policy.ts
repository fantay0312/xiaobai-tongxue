/** Empty notebooks and narrow screens always leave the reading area unobstructed. */
export function shouldAutoOpenNotebook(pinned: boolean, hasContent: boolean, width: number): boolean {
  return pinned && hasContent && width >= 1080;
}
