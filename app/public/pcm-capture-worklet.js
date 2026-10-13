// 采音线程：把麦克风的浮点采样攒成小块交给主线程。重采样与发送在主线程做。
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const count = Math.min(channel.length - offset, this.buffer.length - this.length);
      this.buffer.set(channel.subarray(offset, offset + count), this.length);
      this.length += count;
      offset += count;
      if (this.length === this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0));
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('xb-pcm-capture', PcmCapture);
