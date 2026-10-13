import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  commerceErrorMessage,
  fetchCommerceCatalog,
  fetchCommerceSummary,
  redeemCommerceCode,
  type CommerceCatalog,
  type CommercePrice,
  type CommerceSummary,
} from '../../lib/commerce';
import { CircleAlert, CircleCheck, Ticket } from 'lucide-react';
import { Badge, Button, Input, Skeleton } from '../ui';
import styles from './ProfileCommerce.module.css';
import sections from './ProfileCommerceSections.module.css';

function formatPoints(value: string): string {
  try {
    return new Intl.NumberFormat('zh-CN').format(BigInt(value));
  } catch {
    return value;
  }
}

function formatDate(value: string | null): string {
  if (!value) return '长期有效';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
    : value;
}

function formatEntitlementValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '已开启' : '未开启';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (value && typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      return serialized.length > 36 ? `${serialized.slice(0, 33)}…` : serialized;
    } catch {
      return '已配置';
    }
  }
  return '已生效';
}

function periodLabel(value: string): string {
  const labels: Record<string, string> = {
    free: '免费',
    month: '月',
    monthly: '月',
    quarter: '季',
    quarterly: '季',
    year: '年',
    yearly: '年',
    one_time: '一次性',
    lifetime: '长期',
    custom: '自定义周期',
  };
  return labels[value] ?? value;
}

function priceLabel(price: CommercePrice): string {
  const amount = Number(price.amountMinor);
  const currency = price.currency === 'CNY' ? '¥' : `${price.currency} `;
  if (!Number.isFinite(amount) || amount === 0) return '免费';
  return `${currency}${(amount / 100).toFixed(2)} / ${periodLabel(price.billingPeriod)}`;
}

export function ProfileCommerce() {
  const [catalog, setCatalog] = useState<CommerceCatalog | null>(null);
  const [summary, setSummary] = useState<CommerceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [redemptionNotice, setRedemptionNotice] = useState<string | null>(null);

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    setIssue(null);
    try {
      const [nextSummary, nextCatalog] = await Promise.all([
        fetchCommerceSummary({ signal }),
        fetchCommerceCatalog({ signal }),
      ]);
      setSummary(nextSummary);
      setCatalog(nextCatalog);
    } catch (error) {
      const message = commerceErrorMessage(error);
      if (message) setIssue(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  const activeFeatures = useMemo(
    () => summary?.features.filter((feature) => feature.enabled) ?? [],
    [summary],
  );

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized || redeeming) return;
    setRedeeming(true);
    setIssue(null);
    setRedemptionNotice(null);
    try {
      const result = await redeemCommerceCode(normalized);
      if (result.commerce) setSummary(result.commerce);
      else void load();
      setCode('');
      const labels = result.rewards.map((reward) => reward.label).filter(Boolean);
      setRedemptionNotice(labels.length ? `兑换成功：${labels.join('、')}` : '兑换成功，权益已到账。');
    } catch (error) {
      setIssue(commerceErrorMessage(error));
    } finally {
      setRedeeming(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loading} role="status" aria-label="正在读取订阅与用量">
        <Skeleton height={92} radius="var(--r-lg)" />
        <Skeleton width="38%" height={12} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {issue ? (
        <div className={styles.issue} role="alert">
          <CircleAlert size={17} strokeWidth={1.75} />
          <p>{issue}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>重新读取</Button>
        </div>
      ) : null}

      <section className={styles.account} aria-labelledby="commerce-account-title">
        <div className={styles.plan}>
          <span className={styles.eyebrow}>当前套餐</span>
          <h4 id="commerce-account-title">{summary?.subscription?.planName ?? '基础套餐'}</h4>
          <span className={styles.planNote}>
            {summary?.subscription
              ? `有效至 ${formatDate(summary.subscription.endsAt)}`
              : '当前未开通付费订阅'}
          </span>
        </div>
        <div className={styles.balance}>
          <span className={styles.eyebrow}>可用积分</span>
          <strong>{formatPoints(summary?.wallet.available ?? '0')}</strong>
        </div>
        <p className={styles.boundary}>
          用量积分只用于 AI 能力与服务权益，不计入学习等级、成长评价或排名。
        </p>
      </section>

      <section className={sections.section} aria-labelledby="effective-title">
        <header className={sections.head}>
          <div>
            <h4 id="effective-title">当前生效权益</h4>
            <p>由套餐、CDK 与临时授权合并计算，以服务端结果为准。</p>
          </div>
          <Badge tone={activeFeatures.length ? 'accent' : 'neutral'}>{activeFeatures.length} 项能力可用</Badge>
        </header>
        {summary?.entitlements.length ? (
          <ul className={sections.entitlements}>
            {summary.entitlements.map((entitlement) => (
              <li key={`${entitlement.key}-${entitlement.expiresAt ?? 'lasting'}`}>
                <CircleCheck size={16} strokeWidth={1.75} />
                <span className={sections.entitlementCopy}>
                  <strong>{entitlement.name}</strong>
                  <small>{entitlement.key}</small>
                </span>
                <em>
                  {formatEntitlementValue(entitlement.value)}
                  {' · '}
                  {entitlement.expiresAt ? formatDate(entitlement.expiresAt) : '长期'}
                </em>
              </li>
            ))}
          </ul>
        ) : (
          <div className={sections.empty}>
            <strong>暂无额外权益</strong>
            <span>兑换 CDK 或开通套餐后，权益会在这里出现。</span>
          </div>
        )}
      </section>

      <section className={sections.section} aria-labelledby="plans-title">
        <header className={sections.head}>
          <div>
            <h4 id="plans-title">开放套餐</h4>
            <p>
              目录由运营后台发布；首版由运营授予或 CDK 开通，价格仅作套餐展示。
              历史订阅始终保留开通时的权益快照。
            </p>
          </div>
        </header>
        {catalog?.plans.length ? (
          <div className={sections.plans}>
            {catalog.plans.map((plan) => (
              <article key={plan.id}>
                <span className={sections.planCode}>{plan.code || 'PLAN'}</span>
                <h5>{plan.name}</h5>
                <p>{plan.tagline || plan.description}</p>
                <div className={sections.planFoot}>
                  <strong>{plan.prices[0] ? priceLabel(plan.prices[0]) : '待公布'}</strong>
                  <small>{plan.entitlements.length} 项权益</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={sections.empty}>
            <strong>暂无公开套餐</strong>
            <span>运营团队发布套餐后，会自动同步到这里。</span>
          </div>
        )}
      </section>

      <section className={sections.section} aria-labelledby="redeem-title">
        <header className={sections.head}>
          <div>
            <h4 id="redeem-title">兑换权益</h4>
            <p>CDK 可发放用量积分、订阅时长或指定功能权益。</p>
          </div>
        </header>
        <form className={sections.redeem} onSubmit={(event) => void submitCode(event)}>
          <label className={sections.srOnly} htmlFor="commerce-cdk">兑换码</label>
          <div className={sections.redeemRow}>
            <Input
              id="commerce-cdk"
              className={sections.codeInput}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              leading={<Ticket size={16} strokeWidth={1.75} />}
              autoComplete="off"
              spellCheck={false}
              maxLength={96}
              placeholder="XXXX-XXXX-XXXX"
              aria-describedby="commerce-cdk-note"
            />
            <Button type="submit" variant="solid" size="lg" loading={redeeming} disabled={!code.trim()}>
              {redeeming ? '正在核销…' : '兑换'}
            </Button>
          </div>
          <small id="commerce-cdk-note">每个兑换请求都由服务器原子核销，重复提交不会重复到账。</small>
        </form>
        {redemptionNotice ? (
          <p className={styles.success} role="status">
            <CircleCheck size={17} strokeWidth={1.75} />
            {redemptionNotice}
          </p>
        ) : null}
      </section>
    </div>
  );
}
