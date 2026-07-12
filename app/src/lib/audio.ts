/**
 * 课堂口述录音 —— MediaRecorder 采集 + 浏览器内转 16kHz 单声道 WAV。
 * 为什么转 WAV:MediaRecorder 各家容器不一(Chrome webm/opus、Safari mp4/aac),
 * 转写上游对容器的支持参差;PCM WAV 是所有 OpenAI 兼容转写端点的公约数。
 * 16k 单声道 ≈ 32KB/s,两三分钟的口述也远在网关 8MB 上限之内。
 * 浏览器专用(内含 navigator/AudioContext),严禁进 engine barrel(simulate 在 Node 加载)。
 */

export interface Recorder {
  /** 结束录音并回收麦克风,返回原始容器 Blob(webm/mp4 由浏览器定) */
  stop: () => Promise<Blob>;
  /** 放弃录音:回收麦克风,丢弃已录内容 */
  cancel: () => void;
}

/** 申请麦克风并开录。权限被拒/无设备时抛 DOMException(调用方给人话提示) */
export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  const releaseMic = () => stream.getTracks().forEach((t) => t.stop());

  return {
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        const settle = () => {
          releaseMic();
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        };
        // 录音可能已自行结束(拔麦克风/浏览器站点控制里撤权限/移动端切后台):
        // 此时 onstop 永远不会再来,必须立刻用已收的分片了结,否则按钮卡死在"听写中"
        if (recorder.state === 'inactive') return settle();
        recorder.onstop = settle;
        recorder.onerror = () => {
          releaseMic();
          reject(new Error('record-failed'));
        };
        try {
          recorder.stop();
        } catch {
          settle(); // stop() 抛错(状态竞争)同样按已收分片了结
        }
      }),
    cancel: () => {
      try { recorder.stop(); } catch { /* 已停止也无妨 */ }
      releaseMic();
    },
  };
}

const TARGET_RATE = 16_000;

/** 任意浏览器音频容器 → 16kHz 单声道 PCM16 WAV(解码交给浏览器,重采样交给 OfflineAudioContext) */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const raw = await blob.arrayBuffer();
  // 先按原生采样率解码(decodeAudioData 在部分实现里不跟随 context 采样率),再离线重采样
  const probe = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await probe.decodeAudioData(raw);
  } finally {
    void probe.close();
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded; // 多声道在此自动下混单声道
  source.connect(offline.destination);
  source.start();
  const mono = await offline.startRendering();
  return encodeWavPcm16(mono.getChannelData(0), TARGET_RATE);
}

/** Float32 PCM → 16-bit PCM WAV(44 字节标准头) */
function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt 块长度
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true);           // 块对齐
  view.setUint16(34, 16, true);          // 位深
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
