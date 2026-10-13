"""Exercise the actual upstream scheduler and SDK against an isolated SSE model."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
from types import SimpleNamespace
import unittest

from runner import AsyncOpenAI, BudgetedCompletions, run_study


class ModelHandler(BaseHTTPRequestHandler):
    calls = {}
    requests = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.requests.append(payload)
        model = payload["model"]
        index = sum(message.get('role') == 'assistant' for message in payload['messages'])
        self.calls[model] = self.calls.get(model, 0) + 1
        texts = ["``PLAN``\n解释权重与加权组合。", "``CHECK``\n材料 [1] 说明权重不等于只选一个词。", "<think>PRIVATE_MODEL_THINKING</think>``FINISH``\n**本地测试模型回复**\n\n注意力把相关信息按权重组合起来。[1]\n你能解释 Value 的作用吗？"]
        variants = {
            'normal': texts[2],
            'post-thinking': '``FINISH``\n<think>PRIVATE_POST_LABEL_THINKING</think>Public answer',
            'unclosed-thinking': '``FINISH``\nPublic answer <thinking>PRIVATE_UNCLOSED',
            'only-thinking': '``FINISH``\n<think>PRIVATE_ONLY</think>',
        }
        content = (texts[index] if index < 2 else variants[model]) if model in variants else "``TOOL``\n尝试执行命令"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for delta in ({"role": "assistant", "content": content}, {}):
            data = {"id": "fixture", "object": "chat.completion.chunk", "created": 1, "model": model, "choices": [{"index": 0, "delta": delta, "finish_reason": "stop" if not delta else None}]}
            self.wfile.write(f"data: {json.dumps(data)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


class RuntimeTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ModelHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    async def invoke(self, model):
        async with AsyncOpenAI(base_url=f"http://127.0.0.1:{self.server.server_port}/v1", api_key="local-fixture", max_retries=0) as sdk:
            limited = BudgetedCompletions(sdk.chat.completions)
            client = SimpleNamespace(chat=SimpleNamespace(completions=limited))
            return await run_study({"model": model, "study": {"question": "注意力是什么？", "sources": [{"id": "1", "excerpt": "对信息加权组合"}]}}, client)

    async def test_real_scheduler_plan_check_finish(self):
        result = await self.invoke("normal")
        self.assertEqual(result["rounds"], 3)
        self.assertEqual(result["engine"], "deeptutor")
        self.assertNotIn("PRIVATE_MODEL_THINKING", result["content"])
        self.assertNotIn("PLAN", result["content"])
        self.assertIn("[1]", result["content"])

    async def test_tools_disabled_and_budget_bounded(self):
        with self.assertRaisesRegex(ValueError, "incomplete-study"):
            await self.invoke("tool-attempt")
        self.assertEqual(ModelHandler.calls["tool-attempt"], 4)
        for request in ModelHandler.requests:
            self.assertNotIn("tools", request)
            self.assertEqual(request["max_tokens"], 2200)

    async def test_post_label_and_unclosed_thinking_never_reach_answer(self):
        for model in ('post-thinking', 'unclosed-thinking'):
            with self.subTest(model=model):
                result = await self.invoke(model)
                self.assertEqual(result['content'], 'Public answer')
                self.assertNotIn('PRIVATE', result['content'])
        with self.assertRaisesRegex(ValueError, 'incomplete-study'):
            await self.invoke('only-thinking')


if __name__ == "__main__":
    import sys
    if "--serve" in sys.argv:
        port = int(sys.argv[sys.argv.index("--serve") + 1])
        print(f"Local test model on 127.0.0.1:{port}; no external calls.", flush=True)
        ThreadingHTTPServer(("127.0.0.1", port), ModelHandler).serve_forever()
    else:
        unittest.main(verbosity=2)
