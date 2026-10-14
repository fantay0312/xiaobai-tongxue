import { useEffect, useRef, useState } from 'react';
import { API_BASE, gatewayFetch } from '../../lib/api';
import type { Block } from './types';
import { readerServiceHeaders } from './api';
export function useListen(blocks: Block[], rate: number, onPosition: (index: number) => void, onError: (text: string) => void) {
  const [state, setState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const session = useRef(0); const audio = useRef<HTMLAudioElement | null>(null); const controller = useRef<AbortController | null>(null);
  const current = useRef(0); const naturalVoice = useRef(false); const callbacks = useRef({ onPosition, onError }); callbacks.current = { onPosition, onError };
  const rateRef = useRef(rate); rateRef.current = rate;
  const stop = () => { session.current++; controller.current?.abort(); audio.current?.pause(); audio.current = null; window.speechSynthesis?.cancel(); setState('stopped'); };
  async function speak(index: number, version: number, part = 0) {
    if (version !== session.current) return;
    while (index < blocks.length && !['paragraph', 'heading'].includes(blocks[index].kind)) index++;
    if (index >= blocks.length) { setState('stopped'); return; }
    current.current = index; callbacks.current.onPosition(index);
    const fullText = blocks[index].text;
    const text = fullText.slice(part * 1200, (part + 1) * 1200);
    const next = () => (part + 1) * 1200 < fullText.length ? speak(index, version, part + 1) : speak(index + 1, version);
    try {
      if (naturalVoice.current) {
        const abort = new AbortController(); controller.current = abort;
        const response = await gatewayFetch(`${API_BASE}/reader/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...readerServiceHeaders() }, body: JSON.stringify({ text }), signal: abort.signal });
        if (!response.ok) throw new Error(response.status === 503 ? '服务器尚未配置自然语音，请改用设备语音。' : '自然语音暂时不可用，请重试。');
        const url = URL.createObjectURL(await response.blob());
        if (version !== session.current) { URL.revokeObjectURL(url); return; }
        const player = new Audio(url); audio.current = player; player.playbackRate = rateRef.current;
        player.onended = () => { URL.revokeObjectURL(url); void next(); };
        player.onerror = () => { URL.revokeObjectURL(url); callbacks.current.onError('音频播放失败，请重试。'); stop(); };
        await player.play();
      } else {
        if (!window.speechSynthesis) throw new Error('当前浏览器不支持设备朗读。');
        const utterance = new SpeechSynthesisUtterance(text); utterance.rate = rateRef.current;
        utterance.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US';
        utterance.onend = () => { void next(); };
        utterance.onerror = (event) => { if (version === session.current && event.error !== 'interrupted' && event.error !== 'canceled') { callbacks.current.onError('设备朗读失败，可重试或更换语音。'); stop(); } };
        window.speechSynthesis.speak(utterance);
      }
    } catch (error) { if (version === session.current) { callbacks.current.onError(error instanceof Error ? error.message : '朗读失败'); stop(); } }
  }
  const play = (index: number, natural = false) => { stop(); naturalVoice.current = natural; setState('playing'); void speak(index, session.current); };
  const toggle = () => {
    if (state === 'playing') { audio.current?.pause(); window.speechSynthesis?.pause(); setState('paused'); }
    else if (state === 'paused') { void audio.current?.play(); window.speechSynthesis?.resume(); setState('playing'); }
  };
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate]);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    navigator.mediaSession.setActionHandler('pause', () => { audio.current?.pause(); window.speechSynthesis?.pause(); setState('paused'); });
    navigator.mediaSession.setActionHandler('play', () => { void audio.current?.play(); window.speechSynthesis?.resume(); setState('playing'); });
    return () => { navigator.mediaSession.setActionHandler('pause', null); navigator.mediaSession.setActionHandler('play', null); };
  }, []);
  useEffect(() => () => { session.current++; controller.current?.abort(); audio.current?.pause(); window.speechSynthesis?.cancel(); }, []);
  return { state, current, play, toggle, stop };
}
