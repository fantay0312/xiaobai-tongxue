/** 工具的中文名与一行说明：时间线卡片、审批卡片、并行助手的足迹都用这一份。 */
import type { PlanProposal } from './types';

export const TOOL_LABELS: Record<string, string> = {
  update_plan: '更新计划',
  search_papers: '检索文献',
  read_paper: '读文献',
  save_paper: '保存文献',
  list_files: '查看文件',
  read_file: '读文件',
  write_file: '写文件',
  edit_file: '改文件',
  delete_file: '删除文件',
  run_python: '运行 Python',
  read_library_file: '读资料库',
  spawn_workers: '并行助手',
  ask_user: '询问',
  finish: '完成',
  propose_plan: '提交计划',
  set_goal: '设定目标',
};

export const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;

export function parseArgs(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const text = (value: unknown, max = 80) => (typeof value === 'string' ? (value.length > max ? `${value.slice(0, max)}…` : value) : '');

/** 一行说明这次调用在做什么，如「检索 graph neural network traffic」 */
export function describeCall(name: string, argsJson: string): string {
  const args = parseArgs(argsJson);
  switch (name) {
    case 'search_papers': return text(args.query) || '文献';
    case 'read_paper': return text(args.id);
    case 'save_paper': return text(args.id);
    case 'list_files': return text(args.dir) || '全部';
    case 'read_file':
    case 'write_file':
    case 'edit_file':
    case 'delete_file': return text(args.path);
    case 'run_python': return text(args.save_as) || text(String(args.code ?? '').trim().split('\n')[0], 60);
    case 'read_library_file': return text(args.file) || '文件列表';
    case 'spawn_workers': return Array.isArray(args.tasks) ? `${args.tasks.length} 个子任务` : '';
    case 'ask_user': return text(args.question);
    case 'update_plan': return Array.isArray(args.items) ? `${args.items.length} 项` : '';
    case 'set_goal': return text(args.objective);
    default: return '';
  }
}

export function planToMarkdown(plan: PlanProposal): string {
  if (plan.raw) return plan.raw;
  const section = (title: string, items: string[], ordered = false) =>
    (items.length ? `\n\n**${title}**\n${items.map((item, index) => `${ordered ? `${index + 1}.` : '-'} ${item}`).join('\n')}` : '');
  return `**目标**：${plan.objective}${section('步骤', plan.steps, true)}${section('来源', plan.sources)}${section('预期产出', plan.outputs)}${section('风险与假设', plan.risks)}`;
}

/** 模型调用失败时给用户看的原因 */
export function describeModelError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'model-auth') return '模型服务拒绝了请求：登录已失效，或接口密钥不对。请重新登录，或在设置里检查模型接口。';
  if (code === 'model-busy' || code === 'model-rate-limited') return '模型服务正忙，请稍后再试。';
  if (code === 'model-timeout') return '模型响应超时，这一轮没有完成。可以点「继续」重试。';
  if (code === 'model-network') return '连不上模型服务。请检查网络，或确认已登录。';
  if (code === 'model-stream-incomplete' || code === 'model-stream-invalid') return '模型的回复中途断开了。可以点「继续」重试。';
  if (/^model-http-4/.test(code)) return `模型服务拒绝了这次请求（${code.replace('model-http-', 'HTTP ')}）。可以换一个模型或降低思考强度后重试。`;
  if (/^model-/.test(code)) return `模型调用失败（${code}）。可以点「继续」重试。`;
  return code ? `这一轮出错了：${code.slice(0, 160)}` : '这一轮出错了，可以点「继续」重试。';
}

export const MODEL_UNAVAILABLE_TEXT = '现在没有可用的模型，科研助手无法工作：需要登录后使用服务器线路，或在设置里填写自己的模型接口。课题文件仍然可以查看、编辑和导出。';
