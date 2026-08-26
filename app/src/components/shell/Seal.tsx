/**
 * 品牌章 —— 全站唯一品牌标记:伏案执笔的小白同学。
 * 与 public/favicon-32.png / favicon-192.png / apple-touch-icon.png 同一枚章
 * (页签图标另铺一层奶白纸底圆角,保证深色页签栏下也读得出),
 * 换标时四处一并重出,源图见 doc/素材/logo.png。
 *
 * plate='paper' 走页签那张奶白底板;默认随主题:科技暗底、漫画夜景用纸底,其余用源图。
 */
import { useThemeStore } from '../../store/themeStore';

const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`;
const LOGO_PAPER_URL = `${import.meta.env.BASE_URL}favicon-192.png`;

export function Seal({
  className,
  plate,
}: {
  className?: string;
  plate?: 'ink' | 'paper';
}) {
  const theme = useThemeStore((state) => state.theme);
  const tone = useThemeStore((state) => state.tone);
  const darkPlate = theme === 'tech' || (theme === 'anime' && tone === 'night');
  const resolved = plate ?? (darkPlate ? 'paper' : 'ink');

  return (
    <img
      className={className}
      src={resolved === 'paper' ? LOGO_PAPER_URL : LOGO_URL}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
