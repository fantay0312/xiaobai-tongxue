import { Cpu } from 'lucide-react';
import { barBtn } from './Popover';
import { hostMessage } from '@/compat/bridge';
export function KeyMenu() {
  return <button type="button" className={barBtn} aria-label="全局模型设置" data-tip="模型设置" onClick={() => hostMessage('settings')}><Cpu size={15} aria-hidden /></button>;
}
