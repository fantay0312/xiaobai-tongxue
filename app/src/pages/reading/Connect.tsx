import { useEffect, useState } from 'react';
import { Copy, Link, Trash2 } from 'lucide-react';
import { Button, Dialog, Input } from '../../components/ui';
import { API_BASE } from '../../lib/api';
import { readerApi, readerError } from './api';
import s from './reading.module.css';
export function Connect({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tokens, setTokens] = useState<{ id: string; name: string; last_used_at: string | null }[]>([]);
  const [name, setName] = useState('我的 Agent'); const [config, setConfig] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const refresh = () => readerApi<{ tokens: typeof tokens }>('/tokens').then((data) => setTokens(data.tokens)).catch((e) => setError(readerError(e)));
  useEffect(() => { if (open) { void refresh(); } else setConfig(''); }, [open]);
  const create = async () => {
    setBusy(true); setError('');
    try {
      const data = await readerApi<{ token: string }>('/tokens', { name });
      setConfig(JSON.stringify({ mcpServers: { 'xiaobai-reader': { type: 'http', url: `${location.origin}${API_BASE}/reader/mcp`, headers: { Authorization: `Bearer ${data.token}` } } } }, null, 2));
      await refresh();
    } catch (e) { setError(readerError(e)); } finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={(value) => !value && onClose()} title="连接 Agent" description="让你的 AI 助手把文章和笔记收进阅读书架。">
    <div className={s.settings}><p>支持 save_articles、save_text、search_library、list_topics。每个连接可以读取和新增当前账号的阅读资料，请只交给信任的工具。</p>
      <Input aria-label="连接名称" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
      <Button variant="solid" icon={<Link size={16} />} loading={busy} disabled={!name.trim()} onClick={() => void create()}>创建连接</Button>
      {config && <><p>凭据仅显示这一次，关闭后无法再次查看。</p><pre className={s.config}>{config}</pre><Button icon={<Copy size={15} />} onClick={() => void navigator.clipboard.writeText(config)}>复制 MCP 配置</Button></>}
      {tokens.map((token) => <div className={s.setting} key={token.id}><span>{token.name}<small>{token.last_used_at ? `最近使用 ${new Date(token.last_used_at).toLocaleDateString()}` : '尚未使用'}</small></span><Button variant="ghost" icon={<Trash2 size={14} />} onClick={async () => { try { await readerApi(`/tokens/${token.id}`, undefined, 'DELETE'); await refresh(); } catch (e) { setError(readerError(e)); } }}>撤销</Button></div>)}
      {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
