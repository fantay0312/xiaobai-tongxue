import { BookOpen, Cpu, ExternalLink } from 'lucide-react';
import { Dialog, Button } from '../../components/ui';
import { useShellActions } from '../../components/shell/ShellActions';
import { DEFAULT_PREFS, type ReaderPrefs } from './types';
import s from './reading.module.css';
import { readServiceKey, writeServiceKey } from './api';

export function ReadingSettings({ prefs, onChange, open, onClose }: { prefs: ReaderPrefs; onChange: (prefs: ReaderPrefs) => void; open: boolean; onClose: () => void }) {
  const { openSettings } = useShellActions();
  const [serviceKey, setServiceKey] = useState(readServiceKey);
  const patch = (key: keyof ReaderPrefs, value: unknown) => onChange({ ...prefs, [key]: value });
  const select = (key: keyof ReaderPrefs, label: string, options: Record<string, string>) => <label className={s.setting}><span>{label}</span><select aria-label={label} value={String(prefs[key])} onChange={(event) => patch(key, event.target.value)}>{Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>;
  const toggle = (key: keyof ReaderPrefs, label: string) => <label className={s.setting}><span>{label}</span><input type="checkbox" checked={!!prefs[key]} onChange={(event) => patch(key, event.target.checked)} /></label>;
  return <Dialog open={open} onOpenChange={(value) => !value && onClose()} title="阅读设置" size="md">
    <div className={s.settings}>
      <h3><BookOpen size={18} /> 纸张与排版</h3>
      {select('theme', '纸张', { auto: '跟随系统', paper: '纸白', sepia: '旧纸', snow: '纯白', night: '夜读', ink: '墨蓝' })}
      {select('face', '字体', { serif: '衬线', book: '书卷', sans: '无衬线', legible: '易读' })}
      <label className={s.setting}><span>字号 · {prefs.size}</span><input aria-label="字号" type="range" min="15" max="28" value={prefs.size} onChange={(event) => patch('size', Number(event.target.value))} /></label>
      {select('leading', '行距', { tight: '紧凑', normal: '标准', loose: '宽松' })}
      {select('width', '正文宽度', { narrow: '窄', normal: '标准', wide: '宽' })}
      {select('align', '对齐', { left: '左对齐', justify: '两端对齐' })}
      {select('paras', '段落', { spaced: '段间留白', indented: '首行缩进' })}
      {select('pen', '批注笔色', { vermilion: '朱红', cobalt: '钴蓝', moss: '苔绿', graphite: '石墨' })}
      {select('marker', '高亮色', { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色' })}
      {toggle('numbers', '显示段落编号')}{toggle('rail', '显示段落导航')}{toggle('listen', '启用朗读')}
      <p className={s.hint}>朗读默认使用设备语音；服务器配置语音服务后可选自然语音。</p>
      <h3><Cpu size={18} /> 回答</h3>
      {select('length', '回答长度', { short: '简短', normal: '标准', long: '详细' })}{toggle('search', '普通问答允许联网检索')}{toggle('painted', '导入后自动绘制封面（需配置绘图服务）')}
      <p className={s.hint}>主动点击“联网核查”会执行一次检索；普通问答遵循上面的联网开关。</p>
      <Button icon={<ExternalLink size={15} />} onClick={() => { onClose(); openSettings(); }}>设置默认模型与思考强度</Button>
      <p className={s.hint}>阅读问答、导读与分类沿用全站默认模型。外观设置保存在当前账号的这台设备。</p>
      <h3>自然语音与封面绘制</h3>
      <p className={s.hint}>这两项使用 Together 服务，按其实际用量收费。可填自己的密钥，或使用管理员已配置的线路。密钥只保存在当前账号的浏览器，仅随你发起的朗读和绘图请求发送。</p>
      <label className={s.setting}><span>Together API key</span><input aria-label="阅读扩展服务密钥" type="password" autoComplete="off" value={serviceKey} onChange={(event) => { setServiceKey(event.target.value); writeServiceKey(event.target.value); }} /></label>
      <Button variant="ghost" disabled={!serviceKey} onClick={() => { setServiceKey(''); writeServiceKey(''); }}>清除扩展服务密钥</Button>
      <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_PREFS })}>恢复阅读设置</Button>
    </div>
  </Dialog>;
}
import { useState } from 'react';
