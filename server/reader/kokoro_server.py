"""Private loopback TTS worker. Apache-2.0 Kokoro model; no user credentials."""
import io
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from misaki import zh

ROOT = Path(os.environ.get("READER_KOKORO_ROOT", "/opt/xiaobai-media/kokoro"))
engine = Kokoro(str(ROOT / "kokoro-v1.1-zh.onnx"), str(ROOT / "voices-v1.1-zh.bin"), vocab_config=str(ROOT / "config.json"))
g2p = zh.ZHG2P(version="1.1", en_callable=lambda text: engine.tokenizer.phonemize(text, "en-us"))
voices = engine.get_voices()
allowed = [name for name in ["zf_001", "zf_002", "zm_010"] if name in voices]
if not allowed:
    allowed = voices[:3]
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, status, data, mime="application/json"):
        payload = json.dumps(data).encode() if mime == "application/json" else data
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self.reply(200, {"ok": True, "voices": allowed}) if self.path == "/health" else self.reply(404, {})

    def do_POST(self):
        if self.path != "/speak":
            return self.reply(404, {})
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > 30000:
            return self.reply(413, {"error": "text-too-large"})
        try:
            data = json.loads(self.rfile.read(size))
            text = data.get("text", "")
            voice = data.get("voice") or allowed[0]
            if not isinstance(text, str) or not text.strip() or len(text) > 6000 or voice not in allowed:
                return self.reply(400, {"error": "invalid-input"})
            if not lock.acquire(timeout=80):
                return self.reply(429, {"error": "voice-busy"})
            try:
                rendered = []
                # Keep every clause within the model's phoneme budget; never truncate a passage.
                for paragraph in re.findall(r"[\s\S]{1,90}", text):
                    phonemes, _ = g2p(paragraph)
                    if not phonemes.strip():
                        continue
                    audio, rate = engine.create(phonemes, voice=voice, speed=1.0, is_phonemes=True)
                    rendered.append(audio)
                if not rendered:
                    return self.reply(400, {"error": "no-spoken-text"})
                output = io.BytesIO()
                sf.write(output, np.concatenate(rendered), rate, format="WAV", subtype="PCM_16")
                self.reply(200, output.getvalue(), "audio/wav")
            finally:
                lock.release()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.reply(500, {"error": "voice-failed"})


ThreadingHTTPServer(("127.0.0.1", 18082), Handler).serve_forever()
