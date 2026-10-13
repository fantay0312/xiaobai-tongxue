/**
 * 故事匣：拜师帖、小白日记、小白来信、出师证书、成就印章。
 * 纸质物件沿用 components/story 的原件，这里只做入口和抽屉；内容全部来自事件流派生。
 */
import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Dialog, Sheet } from '../../../../components/ui';
import { MentorLetter } from '../../../../components/story/MentorLetter';
import { XiaobaiDiary } from '../../../../components/story/XiaobaiDiary';
import { XiaobaiLetter } from '../../../../components/story/XiaobaiLetter';
import { MasteryCertificate } from '../../../../components/story/MasteryCertificate';
import { deriveAchievements, type AchievementInput } from '../../../../engine/achievements';
import { deriveXiaobaiLetter } from '../../../../engine/story';
import { loadLearningIdentity, saveLearningIdentity } from '../../../../engine/learningIdentity';
import type { SessionRecord } from './data';
import s from './feynman.module.css';

type Drawer = 'diary' | 'letters' | 'certificate' | null;

const DIARY_LIMIT = 3;
/** 印章缩略一行放得下的枚数 */
const THUMB_SEALS = 3;
const CERTIFICATE_LIMIT = 3;

interface Props {
  owner: string | null;
  input: AchievementInput;
  records: SessionRecord[];
  reviewBusy: boolean;
  onReview: (topicId: string) => void;
  onOpen: (to: string) => void;
}

export function StoryShelf({ owner, input, records, reviewBusy, onReview, onOpen }: Props) {
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [acceptedAt, setAcceptedAt] = useState(() => loadLearningIdentity(owner).acceptedAt);

  const { events, reports, topicStates, topics } = input;

  const seals = useMemo(() => {
    const all = deriveAchievements(input);
    const earned = all
      .filter((seal) => seal.earnedAt !== null)
      .sort((a, b) => ((a.earnedAt ?? '') < (b.earnedAt ?? '') ? 1 : -1));
    return { earned, total: all.length };
  }, [input]);

  const letters = useMemo(() => topics
    .filter((topic) => !topic.locked && topicStates[topic.topicId]?.forgotten)
    .map((topic) => ({
      topic,
      data: deriveXiaobaiLetter({ topic, state: topicStates[topic.topicId], events }),
    })), [topics, topicStates, events]);

  const certificates = useMemo(() => [...reports]
    .reverse()
    .filter((report) => report.masteredNow)
    .flatMap((report) => {
      const topic = topics.find((item) => item.topicId === report.topicId);
      return topic ? [{ topic, report }] : [];
    }), [reports, topics]);

  const diaries = records.filter((record) => record.diary !== null).slice(0, DIARY_LIMIT);
  const latestDiary = diaries[0]?.diary ?? null;

  // 只合并写回 acceptedAt 一项，不动同一份记录里的其他界面选择
  const acceptLetter = () => {
    if (acceptedAt) return;
    const at = new Date().toISOString();
    saveLearningIdentity(owner, { ...loadLearningIdentity(owner), acceptedAt: at });
    setAcceptedAt(at);
  };

  const leave = (to: string) => {
    setDrawer(null);
    onOpen(to);
  };

  const growthLink = (
    <Button
      variant="ghost"
      size="sm"
      iconRight={<ArrowRight size={14} strokeWidth={1.75} />}
      onClick={() => leave('/growth')}
    >
      去成长册看全部
    </Button>
  );

  return (
    <section className={s.section} aria-labelledby="feynman-story-title">
      <header className={s.sectionHead}>
        <div>
          <h2 id="feynman-story-title" className={s.sectionTitle}>故事匣</h2>
          <p className={s.sectionNote}>你和小白之间留下的纸页，都收在这里。</p>
        </div>
        {growthLink}
      </header>

      <div className={s.shelf}>
        <MentorLetter
          embedded
          onAccept={acceptLetter}
          renderTrigger={({ open, ref }) => (
            <button ref={ref} type="button" className={s.storyCard} aria-haspopup="dialog" onClick={open}>
              <span className={s.thumb} data-story aria-hidden="true">
                <span className={s.thumbType}>INVITATION</span>
                <span className={s.thumbHand}>拜师帖</span>
                <span className={s.thumbSeal}>白</span>
              </span>
              <span className={s.storyMeta}>
                <b>拜师帖</b>
                <span>
                  {acceptedAt
                    ? `已收下 · ${new Date(acceptedAt).toLocaleDateString('zh-CN')}`
                    : '小白递来的第一封信'}
                </span>
              </span>
            </button>
          )}
        />

        <button
          type="button"
          className={s.storyCard}
          disabled={diaries.length === 0}
          aria-haspopup="dialog"
          onClick={() => setDrawer('diary')}
        >
          <span className={s.thumb} data-story aria-hidden="true">
            <span className={s.thumbType}>
              {latestDiary ? `${latestDiary.dateLabel} ${latestDiary.weather}` : 'DIARY'}
            </span>
            <span className={s.thumbText}>
              {latestDiary ? latestDiary.paragraphs[0] : '第一页还空着。'}
            </span>
          </span>
          <span className={s.storyMeta}>
            <b>小白日记</b>
            <span>{diaries.length > 0 ? `最近 ${diaries.length} 页` : '上完第一课，他会写下第一页'}</span>
          </span>
        </button>

        <button
          type="button"
          className={s.storyCard}
          disabled={letters.length === 0}
          aria-haspopup="dialog"
          onClick={() => setDrawer('letters')}
        >
          <span className={s.thumb} data-story aria-hidden="true">
            <span className={s.thumbHand}>先生钧鉴</span>
            <span className={s.thumbText}>
              {letters[0] ? letters[0].data.fuzzy : '近来所学，弟子都还记得。'}
            </span>
            {letters.length > 0 && <span className={s.thumbCount}>{letters.length}</span>}
          </span>
          <span className={s.storyMeta}>
            <b>小白来信</b>
            <span>{letters.length > 0 ? `${letters.length} 封等你回信` : '他都还记得，暂时没有来信'}</span>
          </span>
        </button>

        <button
          type="button"
          className={s.storyCard}
          disabled={certificates.length === 0}
          aria-haspopup="dialog"
          onClick={() => setDrawer('certificate')}
        >
          <span className={`${s.thumb} ${s.thumbCert}`} data-story aria-hidden="true">
            <span className={s.thumbType}>CERTIFICATE</span>
            <span className={s.thumbSerif}>结业证书</span>
            <span className={s.thumbSeal} data-ghost={certificates.length === 0 || undefined}>出师</span>
          </span>
          <span className={s.storyMeta}>
            <b>出师证书</b>
            <span>
              {certificates.length > 0
                ? `${certificates.length} 张 · 最近「${certificates[0].topic.title}」`
                : '把一门课讲到出师时颁发'}
            </span>
          </span>
        </button>

        <button type="button" className={s.storyCard} onClick={() => onOpen('/growth')}>
          <span className={s.thumb} data-story aria-hidden="true">
            <span className={s.thumbType}>SEALS</span>
            <span className={s.thumbSeals}>
              {seals.earned.slice(0, THUMB_SEALS).map((seal) => (
                <span key={seal.id} className={s.thumbSeal} data-tier={seal.tier}>{seal.glyph}</span>
              ))}
              {seals.earned.length === 0 && (
                <>
                  <span className={s.thumbSeal} data-ghost>启</span>
                  <span className={s.thumbSeal} data-ghost>正</span>
                  <span className={s.thumbSeal} data-ghost>喻</span>
                </>
              )}
            </span>
          </span>
          <span className={s.storyMeta}>
            <b>成就印章</b>
            <span>
              已落 {seals.earned.length} / {seals.total} 枚
              {seals.earned[0] ? ` · 新印「${seals.earned[0].name}」` : ''}
            </span>
          </span>
        </button>
      </div>

      <Sheet open={drawer === 'diary'} onOpenChange={(open) => !open && setDrawer(null)} title="小白的日记" width={560}>
        <div className={s.drawerBody}>
          {diaries.map((record) => record.diary && (
            <article key={record.report.sessionId} className={s.drawerItem}>
              <p className={s.drawerCaption}>{record.title} · {record.when}</p>
              <XiaobaiDiary page={record.diary} />
              <Button variant="ghost" size="sm" onClick={() => leave(`/review/${record.report.sessionId}`)}>
                看这堂课的批注
              </Button>
            </article>
          ))}
          <div className={s.drawerFoot}>{growthLink}</div>
        </div>
      </Sheet>

      <Sheet open={drawer === 'letters'} onOpenChange={(open) => !open && setDrawer(null)} title="小白的来信" width={520}>
        <div className={s.drawerBody}>
          {letters.map(({ topic, data }) => (
            <article key={topic.topicId} className={s.drawerItem}>
              <p className={s.drawerCaption}>{topic.course} · {topic.title}</p>
              <XiaobaiLetter
                topicTitle={topic.title}
                data={data}
                busy={reviewBusy}
                onReply={() => onReview(topic.topicId)}
              />
            </article>
          ))}
          <div className={s.drawerFoot}>{growthLink}</div>
        </div>
      </Sheet>

      <Dialog
        open={drawer === 'certificate'}
        onOpenChange={(open) => !open && setDrawer(null)}
        title="出师证书"
        description={certificates.length > CERTIFICATE_LIMIT ? `共 ${certificates.length} 张，这里是最近 ${CERTIFICATE_LIMIT} 张` : undefined}
        size="lg"
        footer={growthLink}
      >
        <div className={s.certList}>
          {certificates.slice(0, CERTIFICATE_LIMIT).map(({ topic, report }) => (
            <MasteryCertificate key={report.sessionId} topic={topic} report={report} />
          ))}
        </div>
      </Dialog>
    </section>
  );
}
