/**
 * 品牌章 —— 全站唯一品牌标记:伏案执笔的小白同学。
 * 与 public/favicon-32.png / favicon-192.png / apple-touch-icon.png 同一枚章
 * (页签图标另铺一层奶白纸底圆角,保证深色页签栏下也读得出),
 * 换标时四处一并重出,源图见 doc/素材/logo.png。
 */
const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`;

export function Seal({ className }: { className?: string }) {
  return <img className={className} src={LOGO_URL} alt="" aria-hidden="true" draggable={false} />;
}
