/**
 * 记忆 —— 产品里的两份记忆放在同一处，分开讲清楚：
 *   小砚的记忆：你在学习终端提问时，小砚记下的「你」（engine/tutorMemory，存在当前浏览器）；
 *   小白的记忆：你给小白讲课时，小白记住的课和先生（appStore.memory + 事件流）。
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Tabs, TabPanel } from '../../../components/ui';
import { XiaoyanPet } from '../../../components/coach/XiaoyanPet';
import { XiaobaiAvatar } from '../../../components/xiaobai/XiaobaiAvatar';
import { useTutorMemory } from '../../../engine/tutorMemory';
import { useAppStore } from '../../../store/appStore';
import { TutorMemoryTab } from './memory/TutorMemoryTab';
import { XiaobaiMemoryTab } from './memory/XiaobaiMemoryTab';
import type { TerminalViewProps } from './types';
import s from './memory/memory.module.css';

type MemoryTab = 'xiaoyan' | 'xiaobai';

export default function MemoryView({ owner, topic, topics, onAsk, onOpenTopic, onView }: TerminalViewProps) {
  const [params] = useSearchParams();
  // 支持 /learn?view=memory&tab=xiaobai 直达第二个页签
  const requested = params.get('tab');
  const [tab, setTab] = useState<MemoryTab>(requested === 'xiaobai' ? 'xiaobai' : 'xiaoyan');
  useEffect(() => {
    if (requested === 'xiaobai' || requested === 'xiaoyan') setTab(requested);
  }, [requested]);
  const tutorState = useTutorMemory(owner);
  const xiaobaiCount = useAppStore((st) => st.memory.items.filter((item) => item.kind !== 'bond').length);
  const level = useAppStore((st) => st.global.learningLevel);

  return (
    <div className={s.root}>
      <header className={s.head}>
        <h1>记忆</h1>
        <p>这里有两份记忆，分开保存，互不混写。</p>
      </header>

      <div className={s.duo}>
        <div className={s.who} data-active={tab === 'xiaoyan' || undefined}>
          <span className={s.whoFigure}>
            <XiaoyanPet
              state={tab === 'xiaoyan' ? 'listening' : 'idle'}
              suppressReply
              title="看小砚的记忆"
              aria-label="看小砚的记忆"
              onClick={() => setTab('xiaoyan')}
            />
          </span>
          <div className={s.whoCopy}>
            <strong>小砚的记忆</strong>
            <span>你在学习终端提问时，小砚记下的你：目标、偏好、薄弱点。</span>
          </div>
        </div>
        <div className={s.who} data-active={tab === 'xiaobai' || undefined}>
          <span className={s.whoFigure}>
            <button type="button" className={s.whoAvatar} aria-label="看小白的记忆" title="看小白的记忆" onClick={() => setTab('xiaobai')}>
              <XiaobaiAvatar mood={tab === 'xiaobai' ? 'happy' : 'idle'} level={level} size={52} />
            </button>
          </span>
          <div className={s.whoCopy}>
            <strong>小白的记忆</strong>
            <span>你给小白讲课时，小白记住的课，和他眼里的先生。</span>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value === 'xiaobai' ? 'xiaobai' : 'xiaoyan')}
        variant="pill"
        label="两份记忆"
        items={[
          { value: 'xiaoyan', label: '小砚记得的你', count: tutorState.items.length },
          { value: 'xiaobai', label: '小白记得的课', count: xiaobaiCount },
        ]}
      >
        <TabPanel value="xiaoyan" className={s.panel}>
          <TutorMemoryTab owner={owner} topic={topic} state={tutorState} onAsk={onAsk} onOpenTopic={onOpenTopic} />
        </TabPanel>
        <TabPanel value="xiaobai" className={s.panel}>
          <XiaobaiMemoryTab topics={topics} topic={topic} onOpenTopic={onOpenTopic} onView={onView} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
