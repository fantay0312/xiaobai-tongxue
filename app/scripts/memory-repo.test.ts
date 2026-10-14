import assert from 'node:assert/strict';

const data = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
} });
const { addEntries, commitRepo, loadRepo, repoOps } = await import('../src/engine/memoryRepo');
const { recordTutorTurn, resetTutorTraces, tutorMemoryHints } = await import('../src/engine/tutorMemory');
const { memoryRetention } = await import('../src/engine/memoryRetention');
const { syncXiaobaiRepo } = await import('../src/engine/memory-repo/xiaobai');
const { dreamNow, xiaobaiDreamHint } = await import('../src/engine/dreams');
const { useAppStore } = await import('../src/store/appStore');
const { EMPTY_MEMORY } = await import('../src/engine/learnerMemory');
const { retainedClassroomMemories } = await import('../src/engine/memory-repo/retention');
const source = { type: 'user', label: 'test' };
const add = (owner: string) => addEntries(owner, 'xiaoyan', [{ path: 'MEMORY.md', text: '讲解时先给具体例子', source }], 'user', 'add')[0];

for (const change of ['edit', 'pin', 'move']) {
  const owner = `undo-${change}`;
  const entry = add(owner);
  const original = loadRepo(owner, 'xiaoyan').commits[0].id;
  if (change === 'edit') repoOps.edit(owner, 'xiaoyan', entry.id, { text: '先举例再解释原理' });
  if (change === 'pin') repoOps.pin(owner, 'xiaoyan', entry.id, true);
  if (change === 'move') repoOps.move(owner, 'xiaoyan', entry.id, 'preferences.md');
  const snapshot = loadRepo(owner, 'xiaoyan').files;
  assert.equal(repoOps.revert(owner, 'xiaoyan', original), null, `${change} must not be undone by reverting an older add`);
  assert.deepEqual(loadRepo(owner, 'xiaoyan').files, snapshot);
}
const moved = add('move-undo');
repoOps.move('move-undo', 'xiaoyan', moved.id, 'preferences.md');
assert.ok(repoOps.revert('move-undo', 'xiaoyan', loadRepo('move-undo', 'xiaoyan').commits[0].id));
assert.equal(loadRepo('move-undo', 'xiaoyan').files['MEMORY.md'][0].id, moved.id);

const protectedEntry = add('proposal');
repoOps.setPending('proposal', 'xiaoyan', { id: 'dream', at: new Date().toISOString(), title: 'test', narrative: 'test', method: 'local',
  changes: [{ id: 'remove', kind: 'faded', note: 'test', path: 'MEMORY.md', before: protectedEntry, after: null }] });
repoOps.pin('proposal', 'xiaoyan', protectedEntry.id, true);
assert.equal(repoOps.applyProposal('proposal', 'xiaoyan'), null);
assert.equal(loadRepo('proposal', 'xiaoyan').files['MEMORY.md'][0].pinned, true);
assert.equal(loadRepo('proposal', 'xiaoyan').pending?.changes.length, 1, 'conflicting proposal stays available for review');

commitRepo('duplicates', 'xiaoyan', 'auto', 'old duplicates', draft => {
  for (let index = 0; index < 71; index++) draft.add('MEMORY.md', { id: `old-${index}`, text: '讲解时请先举例', source,
    addedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', author: 'auto', ...(index === 7 ? { pinned: true, edited: true } : {}) });
});
assert.equal(repoOps.deduplicate('duplicates', 'xiaoyan'), 70);
assert.equal(loadRepo('duplicates', 'xiaoyan').files['MEMORY.md'][0].id, 'old-7', 'keep pinned/edited entry');
assert.equal(loadRepo('duplicates', 'xiaoyan').files['MEMORY.md'][0].seen, 71);
assert.equal(repoOps.deduplicate('duplicates', 'xiaoyan'), 0, 'cleanup is idempotent');
assert.ok(repoOps.revert('duplicates', 'xiaoyan', loadRepo('duplicates', 'xiaoyan').commits[0].id));
assert.equal(loadRepo('duplicates', 'xiaoyan').files['MEMORY.md'].length, 71, 'large cleanup is fully reversible');
addEntries('scope', 'xiaoyan', [
  { path: 'courses/a.md', text: '梯度下降更新方向', section: 'wrong', source },
  { path: 'courses/a.md', text: '梯度下降更新方向', section: 'mastered', source },
  { path: 'courses/b.md', text: '梯度下降更新方向', section: 'wrong', source },
], 'auto', 'different contexts');
assert.equal(repoOps.deduplicate('scope', 'xiaoyan'), 0);
assert.equal(loadRepo('scope', 'xiaoyan').files['courses/a.md'].length, 2);
addEntries('polarity', 'xiaoyan', [
  { path: 'preferences.md', text: '喜欢用简单的例子讲解原理', source },
  { path: 'preferences.md', text: '不喜欢用简单的例子讲解原理', source },
  { path: 'goals.md', text: '计划每天学习20分钟', source },
  { path: 'goals.md', text: '计划每天学习60分钟', source },
], 'auto', 'opposing facts');
assert.equal(loadRepo('polarity', 'xiaoyan').files['preferences.md'].length, 2);
assert.equal(loadRepo('polarity', 'xiaoyan').files['goals.md'].length, 2);

const stamp = new Date().toISOString();
const oldStamp = new Date(Date.now() - 9 * 86400000).toISOString();
const once = { id: 'once', text: '梯度下降还没理解', source, addedAt: stamp, updatedAt: stamp, author: 'auto' as const };
assert.equal(memoryRetention(once, 'courses/gradient.md').layer, 'short', 'one observation is not long-term');
assert.equal(memoryRetention({...once,updatedAt:oldStamp,addedAt:oldStamp}, 'courses/gradient.md').active, false);
assert.equal(memoryRetention({...once,seen:3,addedAt:oldStamp}, 'courses/gradient.md').layer, 'long');
assert.equal(memoryRetention({...once,retention:'recent'}, 'courses/gradient.md').layer, 'recent');
commitRepo('weight', 'xiaoyan', 'auto', 'layer samples', draft => {
  draft.add('preferences.md', {...once,id:'style',text:'喜欢先举一个生活中的例子',author:'user'});
  draft.add('goals.md', {...once,id:'unrelated',text:'目标是通过雅思考试',author:'user'});
  draft.add('courses/gradient.md', {...once,id:'short',section:'stuck'});
  draft.add('courses/gradient.md', {...once,id:'expired',text:'梯度下降昨天还是没懂',updatedAt:oldStamp,addedAt:oldStamp});
  draft.add('courses/gradient.md', {...once,id:'recent',text:'最近读过梯度下降',retention:'recent'});
});
const relevant = tutorMemoryHints('weight','gradient',10,'请解释梯度下降');
assert.ok(relevant.some(line=>line.includes('还没理解')));
assert.ok(!relevant.some(line=>line.includes('雅思')||line.includes('昨天')||line.includes('最近读过')));
assert.ok(relevant.length<=3 && relevant.join('').length<=240);
assert.ok(!tutorMemoryHints('weight','gradient',3,'请只给公式解释梯度下降').some(line=>line.includes('例子')), 'current instructions override old style');
repoOps.edit('weight','xiaoyan','short',{retention:'long'});
assert.equal(memoryRetention(loadRepo('weight','xiaoyan').files['courses/gradient.md'].find(entry=>entry.id==='short')!,'courses/gradient.md').layer,'long');
addEntries('free-short','xiaoyan',[{path:'weak-points.md',text:'梯度下降的更新方向还没理解',source}], 'auto','one-off');
assert.ok(tutorMemoryHints('free-short',undefined,3,'解释梯度下降的更新方向').length>0);

useAppStore.setState({ historyOwner: 'teacher-a', memory: EMPTY_MEMORY, events: [] });
useAppStore.getState().addExplicitMemory('讲课之前先用一个生活中的例子', {});
const explicit = useAppStore.getState().memory.items[0];
assert.equal(retainedClassroomMemories('unprojected',[explicit]).length,1);
assert.equal(retainedClassroomMemories('unprojected',[{...explicit,source:'observed',pinned:false,createdAt:oldStamp,lastSeenAt:oldStamp,updatedAt:oldStamp}]).length,0);
assert.equal(syncXiaobaiRepo('teacher-b'), false, 'previous account classroom must not enter the new account repository');
assert.deepEqual(loadRepo('teacher-b', 'xiaobai').files, {});
syncXiaobaiRepo('teacher-a');
const linked = loadRepo('teacher-a', 'xiaobai').files['teacher.md'][0];
assert.equal(linked.pinned, true);
repoOps.remove('teacher-a', 'xiaobai', linked.id);
useAppStore.getState().deleteMemory(linked.id.slice('xb:mem:'.length));
syncXiaobaiRepo('teacher-a');
assert.equal(loadRepo('teacher-a', 'xiaobai').files['teacher.md']?.length ?? 0, 0, 'explicit deletion removes pinned classroom projection');

useAppStore.setState({ historyOwner: 'dream-review', memory: EMPTY_MEMORY, events: [] });
const question = { id: 'question', text: '下一堂能再讲讲这个概念吗？', addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), author: 'dream' as const, source: { type: 'dream', label: 'dream', topicId: 'attention' } };
repoOps.setPending('dream-review', 'xiaobai', { id: 'pending', at: question.addedAt, title: 'dream', narrative: 'dream', method: 'local',
  changes: [{ id: 'add', kind: 'question', note: 'test', path: 'questions.md', before: null, after: question }] });
assert.equal(xiaobaiDreamHint('dream-review', 'attention'), null, 'unaccepted dreams must not affect classroom prompts');
repoOps.applyProposal('dream-review', 'xiaobai');
assert.equal(xiaobaiDreamHint('dream-review', 'attention'), question.text);
repoOps.edit('dream-review', 'xiaobai', question.id, { text: '下一堂先讲一个例子好吗？' });
assert.equal(xiaobaiDreamHint('dream-review', 'attention'), '下一堂先讲一个例子好吗？');
repoOps.remove('dream-review', 'xiaobai', question.id);
assert.equal(xiaobaiDreamHint('dream-review', 'attention'), null, 'deleted questions cannot return from dream history');

useAppStore.getState().setSettings({mode:'mock'});
commitRepo('auto-dream','xiaoyan','auto','retention samples',draft=>{
  draft.add('weak-points.md',{...once,id:'expired-dream',text:'过期的一次性问题',addedAt:oldStamp,updatedAt:oldStamp});
  draft.add('habits.md',{...once,id:'stable-dream',text:'跨天反复确认的稳定学习习惯',addedAt:oldStamp,updatedAt:stamp,seen:4});
});
repoOps.setReview('auto-dream','xiaoyan',true);
const autoDream=await dreamNow('auto-dream','xiaoyan');
assert.equal(autoDream?.review,'applied','dream changes apply automatically');
assert.equal(loadRepo('auto-dream','xiaoyan').review,false,'old confirmation setting is migrated');
assert.equal(loadRepo('auto-dream','xiaoyan').pending,null);
assert.ok(loadRepo('auto-dream','xiaoyan').files['archive.md']?.some(entry=>entry.id==='expired-dream'));
assert.equal(loadRepo('auto-dream','xiaoyan').files['habits.md']?.find(entry=>entry.id==='stable-dream')?.retention,'long');

const originalFetch = globalThis.fetch;
let resolveModel!: (response: Response) => void;
let modelStarted!: () => void;
const started = new Promise<void>((resolve) => { modelStarted = resolve; });
globalThis.fetch = async () => {
  modelStarted();
  return new Promise<Response>((resolve) => { resolveModel = resolve; });
};
useAppStore.getState().setSettings({ mode: 'proxy' });
for (let i = 0; i < 4; i++) recordTutorTurn('clear-race', { question: `记住，我喜欢用生活例子${i}来理解概念`, answer: '好' });
const deadline = setTimeout(() => { throw new Error('background extraction did not start'); }, 10000);
await started;
clearTimeout(deadline);
repoOps.clear('clear-race', 'xiaoyan');
resetTutorTraces('clear-race');
resolveModel(new Response(`event: done\ndata: ${JSON.stringify({ text: JSON.stringify({ memories: [{ kind: 'preference', text: '喜欢先举例再解释', from: 'chat' }] }) })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
await new Promise((resolve) => setTimeout(resolve, 30));
assert.deepEqual(loadRepo('clear-race', 'xiaoyan').files, {}, 'in-flight extraction cannot repopulate a cleared repository');
recordTutorTurn('queued-clear', { question: '我是计算机专业的学生', answer: '好' });
repoOps.clear('queued-clear', 'xiaoyan');
await new Promise((resolve) => setTimeout(resolve, 20));
assert.deepEqual(loadRepo('queued-clear', 'xiaoyan').files, {}, 'queued observation cannot repopulate a cleared repository');
globalThis.fetch = originalFetch;
console.log('Memory repository: conflict-safe undo, proposals, account isolation, classroom deletion, dream review and clear races passed.');
