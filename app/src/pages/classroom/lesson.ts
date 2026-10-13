/**
 * 课堂现场的纯派生:轮次分组、小白的听课状态、小本本条目、下课时的话。
 * 纪律:只用课堂已经摆在明面上的东西——对话、小白每句话的心情、金句与「讲退心魔」两类事后事件。
 * 不读检查清单、导演动作与任何答案键。
 */
import type { ChatMessage, LearnEvent, SessionMode, XiaobaiMood } from '../../types';

export const MOOD_ZH: Record<XiaobaiMood, string> = {
  idle: '平静',
  curious: '好奇',
  confused: '困惑',
  thinking: '琢磨中',
  aha: '开窍了',
  happy: '开心',
  proud: '得意',
  shy: '不好意思',
};

/** 心情的配色档:开窍系黛绿、受挫系藤黄、琢磨中藤黄虚线,其余灰粉笔 */
export type MoodTone = 'glad' | 'warm' | 'think' | 'calm';

const TONE_BY_MOOD: Record<XiaobaiMood, MoodTone> = {
  idle: 'calm',
  curious: 'calm',
  confused: 'warm',
  thinking: 'think',
  aha: 'glad',
  happy: 'glad',
  proud: 'glad',
  shy: 'warm',
};

export const moodTone = (mood: XiaobaiMood): MoodTone => TONE_BY_MOOD[mood] ?? 'calm';

/** 小白头顶的小念头:是心里话,不是台词,所以短、口语、不带称呼 */
const THOUGHT_BY_MOOD: Record<XiaobaiMood, string> = {
  idle: '听着呢',
  curious: '还想再问问',
  confused: '有点绕…',
  thinking: '让我想想…',
  aha: '哦，原来是这样',
  happy: '这下明白了',
  proud: '我能讲给别人听了',
  shy: '有点不好意思',
};

export const thoughtOf = (mood: XiaobaiMood): string => THOUGHT_BY_MOOD[mood] ?? THOUGHT_BY_MOOD.idle;

/** 一轮 = 老师的一段讲解 + 小白随后的回应(含旁白);开场白没有老师的话,自成一段 */
export interface LessonRound {
  key: string;
  teacher: ChatMessage | null;
  replies: ChatMessage[];
}

export function groupRounds(messages: ChatMessage[]): LessonRound[] {
  const rounds: LessonRound[] = [];
  for (const message of messages) {
    if (message.role === 'teacher') {
      rounds.push({ key: message.id, teacher: message, replies: [] });
      continue;
    }
    if (rounds.length === 0) rounds.push({ key: 'prelude', teacher: null, replies: [] });
    rounds[rounds.length - 1].replies.push(message);
  }
  return rounds;
}

export interface FollowState {
  /** 一句话:小白现在跟得怎么样 */
  label: string;
  tone: MoodTone;
  /** 每次小白开口时的心情档,按先后,最多留最近 14 次 */
  trail: MoodTone[];
}

/** 只看小白每句话的心情,推一个「跟课」的大概:看脸色,不看答案 */
export function deriveFollow(messages: ChatMessage[]): FollowState {
  const moods = messages
    .filter((m) => m.role === 'xiaobai' && m.mood !== undefined)
    .map((m) => m.mood as XiaobaiMood);
  const taught = messages.some((m) => m.role === 'teacher');
  const trail = moods.map(moodTone).slice(-14);
  if (!taught || moods.length === 0) return { label: '等老师开讲', tone: 'calm', trail };

  const recent = moods.slice(-3);
  const last = recent[recent.length - 1];
  const lost = recent.filter((m) => m === 'confused' || m === 'shy').length;
  if (last === 'aha' || last === 'happy' || last === 'proud') return { label: '听明白了', tone: 'glad', trail };
  if (lost >= 2) return { label: '有点跟不上', tone: 'warm', trail };
  if (last === 'confused' || last === 'shy') return { label: '这里卡了一下', tone: 'warm', trail };
  if (last === 'curious') return { label: '跟着在问', tone: 'calm', trail };
  return { label: '在听', tone: 'calm', trail };
}

export interface NotebookEntry {
  id: string;
  kind: 'golden' | 'cleared';
  /** golden 为老师原话;cleared 不写内容(错在哪留到复盘再说) */
  text: string;
}

/** 小本本:本场被记下的金句、被老师讲退的心魔,按发生先后 */
export function deriveNotebook(events: LearnEvent[], sessionId: string): NotebookEntry[] {
  const entries: NotebookEntry[] = [];
  for (const event of events) {
    if (event.sessionId !== sessionId) continue;
    if (event.type === 'golden_analogy_saved') {
      const text = String(event.payload.text ?? '').trim();
      if (text) entries.push({ id: event.id, kind: 'golden', text });
    } else if (event.type === 'misconception_corrected') {
      entries.push({ id: event.id, kind: 'cleared', text: '' });
    }
  }
  return entries;
}

/** 讲法提示:点一下往草稿里添一句开头,永不代发 */
export const SCAFFOLDS: readonly { id: string; label: string; starter: string }[] = [
  { id: 'analogy', label: '打个比方', starter: '打个比方，这就好比' },
  { id: 'example', label: '举个例子', starter: '举个例子，比如' },
  { id: 'steps', label: '分步讲', starter: '分三步讲。第一步，' },
  { id: 'key', label: '画重点', starter: '这里最要紧的一点是：' },
  { id: 'rephrase', label: '换个说法', starter: '换个说法，其实就是' },
];

/** 把开头句接到草稿后面:空稿直接放;上一句已收尾就接着写,没收尾另起一行。
    连点两枚提示签(上一句开头还没往下写)算改主意:换掉,不叠成两句空开头 */
export function appendStarter(draft: string, starter: string): string {
  if (!draft.trim()) return starter;
  const pending = SCAFFOLDS.find((item) => draft.endsWith(item.starter));
  if (pending) return `${draft.slice(0, draft.length - pending.starter.length)}${starter}`;
  const tail = draft[draft.length - 1];
  return /[\s。！？!?；;：:，,、]/.test(tail) ? `${draft}${starter}` : `${draft}\n${starter}`;
}

export const clock = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = String(safe % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

/** 用时的口语说法(下课面板用) */
export function spokenDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/** 老师讲过的每一段,各取开头一句做下课面板的「这堂课讲了」 */
export function taughtDigest(messages: ChatMessage[], max = 4): { lines: string[]; more: number } {
  const all = messages
    .filter((m) => m.role === 'teacher' && !m.blocked)
    .map((m) => {
      const plain = m.text.replace(/```[\s\S]*?```/g, '（代码）').replace(/[#*`>$]/g, '').replace(/\s+/g, ' ').trim();
      if (!plain) return m.image ? '（一张讲图）' : '';
      const firstSentence = plain.split(/(?<=[。！？!?])/)[0] ?? plain;
      return firstSentence.length > 34 ? `${firstSentence.slice(0, 34)}…` : firstSentence;
    })
    .filter(Boolean);
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** 下课时小白说的一句:按这堂课实际发生的事挑,不夸没发生的 */
export function partingLine(input: {
  mode: SessionMode;
  rounds: number;
  follow: FollowState;
  goldenCount: number;
  clearedCount: number;
}): string {
  const { mode, rounds, follow, goldenCount, clearedCount } = input;
  if (mode === 'review') {
    return rounds === 0
      ? '老师，我还没想起来多少……要不再提醒我两句？'
      : '想起来了不少，谢谢老师。这回我记牢一点。';
  }
  if (rounds === 0) return '老师还没开讲呢……我现在去考，多半要交白卷。';
  if (follow.tone === 'warm') return '有几处我还没转过弯。先去试试，错了回来老师再给我讲。';
  if (goldenCount > 0) return '老师打的那个比方，我记在小本本上了。那我去考了，考完给老师看。';
  if (clearedCount > 0) return '刚才差点想岔，幸好老师把我拉回来了。那我去考了，考完给老师看。';
  if (follow.tone === 'glad') return '这堂课我听明白了。那我去考了，考成什么样回来给老师看。';
  return '那我去试试。考成什么样，回来给老师看。';
}
