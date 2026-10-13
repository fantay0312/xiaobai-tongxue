const bad = () => { throw new Error('learning-ui-invalid'); };
const string = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim().replace(/\[S(\d+)\]/g,'[$1]') : bad();
const array = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max ? value : bad();

/** Positive projection: no model-provided HTML, functions, tool names, URLs or event handlers. */
export function validateLearningUi(value, sources) {
  if (!value || value.version !== 1) bad();
  const allowed = new Set(sources.map((source) => source.id));
  const ids = new Set();
  const blocks = array(value.blocks, 0, 4).map((block) => {
    const id = string(block?.id, 40);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) bad();
    ids.add(id);
    const sourceIds = [...new Set(array(block.sourceIds, 1, 8))];
    if (sourceIds.some((sourceId) => typeof sourceId !== 'string' || !allowed.has(sourceId))) bad();
    const base = { id, type: block.type, title: string(block.title, 120), sourceIds };
    switch (block.type) {
      case 'concept': return { ...base, body: string(block.body, 2400) };
      case 'flashcard': return { ...base, front: string(block.front, 500), back: string(block.back, 1200) };
      case 'quiz': {
        const options = array(block.options, 2, 5).map((option) => string(option, 240));
        if (!Number.isInteger(block.answerIndex) || block.answerIndex < 0 || block.answerIndex >= options.length) bad();
        return { ...base, question: string(block.question, 600), options, answerIndex: block.answerIndex, explanation: string(block.explanation, 1600) };
      }
      case 'comparison': {
        const columns = array(block.columns, 2, 3).map((column) => string(column, 80));
        const rows = array(block.rows, 2, 6).map((row) => ({ label: string(row?.label, 80), values: array(row.values, columns.length, columns.length).map((item) => string(item, 500)) }));
        return { ...base, columns, rows };
      }
      case 'plan': return { ...base, steps: array(block.steps, 2, 7).map((step) => {
        if (!Number.isInteger(step?.minutes) || step.minutes < 1 || step.minutes > 120) bad();
        return { title: string(step.title, 100), detail: string(step.detail, 700), minutes: step.minutes };
      }) };
      default: return bad();
    }
  });
  return { version: 1, summary: string(value.summary, 4000), blocks, followUps: array(value.followUps ?? [], 0, 3).map((item) => string(item, 160)) };
}

export function learningUiText(ui) {
  return [ui.summary, ...ui.blocks.map((block) => `## ${block.title}\n\n${
    block.type === 'concept' ? block.body
      : block.type === 'flashcard' ? `${block.front}\n\n${block.back}`
        : block.type === 'quiz' ? `${block.question}\n${block.options.map((option, index) => `${index + 1}. ${option}`).join('\n')}\n\n解析：${block.explanation}`
          : block.type === 'plan' ? block.steps.map((step, index) => `${index + 1}. ${step.title}（${step.minutes} 分钟）\n${step.detail}`).join('\n\n')
            : block.rows.map((row) => `${row.label}：${row.values.map((item, index) => `${block.columns[index]} — ${item}`).join('；')}`).join('\n')
  }`)].join('\n\n');
}

export function restoreLearningInteraction(ui, raw) {
  if (!ui || !raw || typeof raw !== 'object') return {};
  return Object.fromEntries(ui.blocks.flatMap((block) => {
    const state = raw[block.id];
    if (!state || typeof state !== 'object') return [];
    if (block.type === 'quiz') return [[block.id, {
      ...(Number.isInteger(state.choice) && state.choice >= 0 && state.choice < block.options.length ? {choice:state.choice} : {}),
      revealed:state.revealed === true,
    }]];
    if (block.type === 'flashcard') return [[block.id,{revealed:state.revealed===true}]];
    if (block.type === 'plan') return [[block.id,{checked:[...new Set(Array.isArray(state.checked)?state.checked.filter((index)=>Number.isInteger(index)&&index>=0&&index<block.steps.length):[])]}]];
    return [];
  }));
}

/** Decode only the first summary JSON string, including split escape sequences. */
export function partialLearningSummary(raw) {
  const match = /"summary"\s*:\s*"/.exec(raw);
  if (!match) return '';
  let fragment = '', escaped = false;
  for (const char of raw.slice(match.index + match[0].length)) {
    if (char === '"' && !escaped) break;
    fragment += char;
    escaped = char === '\\' && !escaped;
  }
  for (let trim = 0; trim <= 6 && trim <= fragment.length; trim += 1) {
    try { return JSON.parse(`"${fragment.slice(0, fragment.length - trim)}"`); } catch { /* An escape may still be arriving. */ }
  }
  return '';
}
