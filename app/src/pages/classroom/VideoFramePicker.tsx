import { useEffect, useRef, useState } from 'react';
import s from './classroom.module.css';

/** 浏览器本地取帧，仍走已验证的辅助讲图链路；不上传整段视频或音轨。 */
export function VideoFramePicker({ file, onFrame, onClose }: {
  file: File;
  onFrame: (frame: File) => Promise<void>;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => { activeRef.current = false; URL.revokeObjectURL(source); };
  }, [file]);
  const capture = async () => {
    const video = videoRef.current;
    if (!video || !ready || busy || video.seeking) return;
    video.pause();
    setBusy(true);
    setError('');
    try {
      const scale = Math.min(1, 1800 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas-unavailable');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('frame-empty')), 'image/jpeg', 0.86,
      ));
      if (!activeRef.current) return;
      await onFrame(new File([blob], 'video-frame.jpg', { type: 'image/jpeg' }));
      if (activeRef.current) onClose();
    } catch {
      if (activeRef.current) setError('这段画面没能截取，请换个时间点或直接选择图片。');
    } finally {
      if (activeRef.current) setBusy(false);
    }
  };
  return (
    <section className={s.videoPicker} aria-label="选择视频中的讲解画面">
      <video ref={videoRef} src={url || undefined} controls playsInline preload="auto"
        onLoadedData={() => setReady(true)} onSeeking={() => setReady(false)} onSeeked={() => setReady(true)}
        onError={() => { setReady(false); setError('浏览器无法播放这段视频，请转换为 MP4 或直接选择图片。'); }} />
      <div className={s.videoActions}>
        <p>暂停在要讲解的画面，只发送这一帧图片，视频与声音留在本机。</p>
        <button type="button" className={s.mediaBtn} onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className={s.sendBtn} onClick={() => void capture()} disabled={!ready || busy}>
          {busy ? '正在取帧…' : '使用这帧画面'}
        </button>
      </div>
      {error && <p role="alert" className={s.imageStatus}>{error}</p>}
    </section>
  );
}
