/** 收尾：常见问题（逐条核对过产品规则与代码）+ 最后一次行动号召。 */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Plus } from 'lucide-react';
import { Button } from '../../components/ui';
import { useAuthStore } from '../../store/authStore';
import base from './landing.module.css';
import s from './closing.module.css';

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: '需要登录吗？怎么注册？',
    a: (
      <>
        <p>这一页随便看；进入学习终端要先登录。</p>
        <p>注册默认用中国大陆手机号和短信验证码，不需要邮箱；注册时要填写邀请码。邮箱可以之后在个人中心验证绑定。登录可以用手机验证码或密码。</p>
      </>
    ),
  },
  {
    q: '用的是什么模型？',
    a: (
      <>
        <p>默认走服务器网关，可选的模型由服务器下发，在输入框旁选模型和思考强度。回答可以展开看模型的思考过程，默认折叠。</p>
        <p>也可以在设置「模型」里改成自定义线路：填自己的接口和密钥，支持 OpenAI Chat、OpenAI Responses、Anthropic Messages、Google Gemini 四种协议，能从端点拉取模型清单再勾选。密钥只存在本机浏览器。</p>
      </>
    ),
  },
  {
    q: '我的资料和学习记录存在哪？',
    a: (
      <>
        <p>资料库里的文件，和自动保存的「我生成的」副本，存在服务器上，归在你的账号下。</p>
        <p>工作台、助理任务、AI 课堂和记忆库保存在当前浏览器，按账号分开，不做云同步，换一台设备不会自动带过去。设置「数据与隐私」里可以导出或清空学习记录。</p>
      </>
    ),
  },
  {
    q: '小白会直接告诉我答案吗？',
    a: (
      <p>不会。小白是你教的学生，他只提问、追问和复述，不讲题，也不透露答案。角色卡能改他的性格和口吻，改不了这条规矩。想听人讲明白，去问小砚。</p>
    ),
  },
  {
    q: '自主练习的分数算成绩吗？',
    a: (
      <p>不算。练一练、题目集和互动卡片里的得分只帮你自查，不计入正式掌握度。正式的检验在「教小白」：备课、上课、赴考、批注复盘。</p>
    ),
  },
  {
    q: '能上传哪些文件？',
    a: (
      <p>什么文件都能存进资料库。PDF、PPT、PPTX、DOCX、Markdown 和 TXT 可以解析，解析后就能拿来提问、生成讲解和练习。</p>
    ),
  },
  {
    q: '手机上能用吗？',
    a: (
      <p>能，打开同一个网址就行。屏幕窄时侧栏变成抽屉，常用板块放在底栏，软键盘弹起时输入框跟着上移。浏览器允许麦克风后，也能语音输入。</p>
    ),
  },
  {
    q: '定时的助理任务会在后台自己跑吗？',
    a: (
      <p>不会。定时任务只在学习终端开着的时候执行，关掉页面就不跑。</p>
    ),
  },
];

export function Closing() {
  const authed = useAuthStore((state) => state.status === 'authed');
  return (
    <section id="faq" className={`${base.chapter} ${base.chapterTinted} ${s.closing}`} aria-labelledby="faq-title">
      <div className={base.wrap}>
        <div className={s.faq}>
          <header className={s.faqHead} data-reveal>
            <span className={s.faqMark}>常见问题</span>
            <h2 id="faq-title" className={s.faqTitle}>开始之前，<span>先把几件事说清楚</span></h2>
            <p className={s.faqLead}>关于账号、模型、数据存放和学习方式，最常被问到的八件事。</p>
          </header>
          <div className={s.faqList} data-reveal style={{ '--reveal-delay': '80ms' } as CSSProperties}>
            {FAQ.map(({ q, a }, index) => (
              <details key={q} name="landing-faq" className={s.item} open={index === 0 || undefined}>
                <summary className={s.question}>
                  <span>{q}</span>
                  <Plus size={18} strokeWidth={1.75} className={s.toggle} aria-hidden="true" />
                </summary>
                <div className={s.answer}>{a}</div>
              </details>
            ))}
          </div>
        </div>

        <div className={s.cta} data-reveal>
          <h2 className={s.ctaTitle}>
            <span>今天学的，</span>
            <span>讲给小白听。</span>
          </h2>
          <div className={s.ctaSide}>
            <div className={s.actions}>
              <Button asChild variant="solid" size="lg" pill className={s.ctaButton} iconRight={<ArrowRight size={17} strokeWidth={2} />}>
                <Link to="/learn">进入学习终端</Link>
              </Button>
              {!authed && (
                <Button asChild variant="ghost" size="lg" pill className={s.ctaButton}>
                  <Link to="/login">登录</Link>
                </Button>
              )}
            </div>
            {!authed && <p className={s.ctaNote}>进入学习终端需要先登录。</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
