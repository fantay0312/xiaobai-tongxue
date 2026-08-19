/**
 * 氛围控件 —— 动漫主题的白天/黑夜,以及可开关的背景乐。
 * 音乐来自 sharyap.com 的 bgm(已镜像到 public/sounds),默认关闭,需用户打开。
 */
import { useEffect, useRef } from 'react';
import { Icon } from '../ui/Icon';
import { soundUrl, useThemeStore } from '../../store/themeStore';
import styles from './Atmosphere.module.css';

export function AmbiencePlayer() {
  const musicOn = useThemeStore((s) => s.musicOn);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const node = audioRef.current;
    if (!node) return;
    node.loop = true;
    node.volume = 0.42;
    if (!musicOn) {
      node.pause();
      return undefined;
    }

    const play = () => {
      void node.play().catch(() => {});
    };
    play();
    window.addEventListener('pointerdown', play, { once: true });
    return () => window.removeEventListener('pointerdown', play);
  }, [musicOn]);

  return (
    <audio
      ref={audioRef}
      src={soundUrl('bgm.mp3')}
      preload="metadata"
      aria-hidden="true"
    />
  );
}

export function AtmosphereToggles() {
  const theme = useThemeStore((s) => s.theme);
  const tone = useThemeStore((s) => s.tone);
  const musicOn = useThemeStore((s) => s.musicOn);
  const setTone = useThemeStore((s) => s.setTone);
  const setMusicOn = useThemeStore((s) => s.setMusicOn);
  const night = theme === 'anime' && tone === 'night';

  return (
    <div className={styles.cluster}>
      {theme === 'anime' && (
        <button
          type="button"
          className={styles.btn}
          onClick={() => setTone(night ? 'day' : 'night')}
          aria-pressed={night}
          aria-label={night ? '切换到日景板' : '切换到夜景板'}
          title={night ? '日景板' : '夜景板'}
        >
          <Icon name={night ? 'sun' : 'moon'} size={16} />
        </button>
      )}
      <button
        type="button"
        className={styles.btn}
        onClick={() => setMusicOn(!musicOn)}
        aria-pressed={musicOn}
        aria-label={musicOn ? '关闭背景音乐' : '打开背景音乐'}
        title={musicOn ? '关闭音乐' : '打开音乐'}
      >
        <Icon name={musicOn ? 'volume' : 'volume-off'} size={16} />
      </button>
    </div>
  );
}
