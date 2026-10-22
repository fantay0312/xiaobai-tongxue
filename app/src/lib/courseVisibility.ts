/** Only explicit project labels count; ordinary subjects such as software testing stay visible. */
export function isValidationCourse(name: string): boolean {
  const title = name.normalize('NFKC').trim();
  return /(?:\[|【)(?:测试|验收|QA|E2E)(?:\]|】)/i.test(title)
    || /^(?:测试|验收)(?:课程|项目|数据|样例|专用|[-_ :\d]|$)/.test(title)
    || /^(?:线上|线下|上传提速|大\s*PDF|功能|性能|回归|接口|联调|冒烟|端到端)(?:测试|验收)(?:[-_ :\d]|$)/i.test(title)
    || /^(?:QA|E2E|SMOKE)[-_ :]/i.test(title)
    || /^TEST(?:[-_:]|\s+(?:course|project|data|run)\b)/i.test(title)
    || /[-_·]\s*(?:测试|验收)(?:[-_ ]*\d{4,14})?$/.test(title)
    || /\((?:测试|验收|QA|E2E)\)$/.test(title);
}

export function partitionCourseGroups<T extends { title: string }>(groups: Array<[string, T]>) {
  const regular: Array<[string, T]> = [];
  const validation: Array<[string, T]> = [];
  for (const group of groups) (isValidationCourse(group[1].title) ? validation : regular).push(group);
  return { regular, validation };
}
