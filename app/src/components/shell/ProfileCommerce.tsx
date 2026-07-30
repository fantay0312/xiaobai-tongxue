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
import { Icon } from '../ui/Icon';
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
      <div className={styles.loading} role="status">
        <span />
        <p><strong>正在翻阅订阅账簿</strong><small>核对套餐、权益与用量积分…</small></p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {issue ? (
        <div className={styles.issue} role="alert">
          <Icon name="circle-x" size={18} />
          <p>{issue}</p>
          <button type="button" onClick={() => void load()}>重新读取</button>
        </div>
      ) : null}

      <section className={styles.account} aria-labelledby="commerce-account-title">
        <div className={styles.accountHead}>
          <div>
            <p>USAGE LEDGER · 用量账簿</p>
            <h3 id="commerce-account-title">
              {summary?.subscription?.planName ?? '基础套餐'}
            </h3>
            <span>
              {summary?.subscription
                ? `有效至 ${formatDate(summary.subscription.endsAt)}`
                : '当前未开通付费订阅'}
            </span>
          </div>
          <div className={styles.balance}>
            <span>可用积分</span>
            <strong>{formatPoints(summary?.wallet.available ?? '0')}</strong>
          </div>
        </div>
        <p className={styles.boundary}>
          用量积分只用于 AI 能力与服务权益，不计入学习等级、成长评价或排名。
        </p>
      </section>

      <section className={sections.section} aria-labelledby="effective-title">
        <header>
          <div>
            <h3 id="effective-title">当前生效权益</h3>
            <p>由套餐、CDK 与临时授权合并计算，以服务端结果为准。</p>
          </div>
          <span>{activeFeatures.length} 项能力可用</span>
        </header>
        {summary?.entitlements.length ? (
          <ul className={sections.entitlements}>
            {summary.entitlements.map((entitlement) => (
              <li key={`${entitlement.key}-${entitlement.expiresAt ?? 'lasting'}`}>
                <Icon name="circle-check" size={17} />
                <span><strong>{entitlement.name}</strong><small>{entitlement.key}</small></span>
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
        <header>
          <div>
            <h3 id="plans-title">开放套餐</h3>
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
                <div>
                  <p>{plan.code || 'PLAN'}</p>
                  <h4>{plan.name}</h4>
                  <span>{plan.tagline || plan.description}</span>
                </div>
                <strong>{plan.prices[0] ? priceLabel(plan.prices[0]) : '待公布'}</strong>
                <small>{plan.entitlements.length} 项权益</small>
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
        <header>
          <div>
            <h3 id="redeem-title">兑换权益</h3>
            <p>CDK 可发放用量积分、订阅时长或指定功能权益。</p>
          </div>
        </header>
        <form className={sections.redeem} onSubmit={(event) => void submitCode(event)}>
          <label htmlFor="commerce-cdk">兑换码</label>
          <div>
            <input
              id="commerce-cdk"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              maxLength={96}
              placeholder="XXXX-XXXX-XXXX"
              aria-describedby="commerce-cdk-note"
            />
            <button type="submit" disabled={redeeming || !code.trim()}>
              <Icon name="ticket" size={17} />
              {redeeming ? '正在核销…' : '兑换 CDK'}
            </button>
          </div>
          <small id="commerce-cdk-note">每个兑换请求都由服务器原子核销，重复提交不会重复到账。</small>
        </form>
        {redemptionNotice ? (
          <p className={styles.success} role="status">
            <Icon name="circle-check" size={18} />
            {redemptionNotice}
          </p>
        ) : null}
      </section>
    </div>
  );
}
