import { useCallback } from 'react'
import { AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { adminApi } from '../lib/api'
import { formatDate, formatInteger } from '../lib/format'
import { useResource } from '../lib/useResource'
import { Feedback, PageHeader, Section, StatusBadge, TableWrap, uiStyles } from '../components/ui'
import styles from '../styles/Page.module.css'

const alertIcons = {
  info: CheckCircle2,
  warning: AlertCircle,
  critical: ShieldAlert,
}

export default function DashboardPage() {
  const loadOverview = useCallback(() => adminApi.overview(), [])
  const resource = useResource(loadOverview, [loadOverview])

  if (resource.loading) return <Feedback kind="loading" detail="正在汇总订阅、积分与治理记录。" />
  if (resource.error) return <Feedback kind="error" detail={resource.error} onRetry={resource.reload} />
  if (!resource.data) return <Feedback kind="empty" />

  const { metrics, alerts, recentActions, generatedAt } = resource.data
  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="OPERATIONS LEDGER"
        title="运营总览"
        description="从商业收入到权限变更，一页查看需要处理的信号与最近留痕。"
      />
      <section className={styles.stats} aria-label="核心运营指标">
        {metrics.map((metric) => (
          <div className={styles.stat} key={metric.key}>
            <span className={styles.statLabel}>{metric.label}</span>
            <strong className={styles.statValue}>{formatInteger(metric.value)}</strong>
            <span className={styles.statNote}>
              {metric.delta !== undefined ? (
                <span className={metric.delta >= 0 ? styles.deltaPositive : styles.deltaNegative}>
                  {metric.delta >= 0 ? '+' : ''}{metric.delta}%
                </span>
              ) : null}{' '}
              {metric.note}
            </span>
          </div>
        ))}
      </section>
      <div className={styles.split}>
        <Section title="最近关键变更" meta={`快照生成于 ${formatDate(generatedAt)}`}>
          {recentActions.length === 0 ? (
            <Feedback kind="empty" detail="还没有可显示的审计记录。" />
          ) : (
            <TableWrap label="最近关键变更">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作者</th>
                  <th>变更</th>
                  <th>对象</th>
                </tr>
              </thead>
              <tbody>
                {recentActions.map((event) => (
                  <tr key={event.id}>
                    <td className={uiStyles.mono}>{formatDate(event.createdAt)}</td>
                    <td>{event.actorEmail}</td>
                    <td>
                      <strong>{event.action}</strong>
                      <div className={uiStyles.muted}>{event.summary}</div>
                    </td>
                    <td><span className={styles.code}>{event.targetType}</span></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Section>
        <Section title="待处理信号" meta={`${alerts.length} 条`}>
          {alerts.length === 0 ? (
            <Feedback kind="empty" title="账册状态平稳" detail="当前没有需要立即处理的信号。" />
          ) : (
            <ul className={styles.alertList}>
              {alerts.map((alert) => {
                const Icon = alertIcons[alert.level]
                return (
                  <li className={styles.alertItem} key={alert.id}>
                    <Icon size={18} aria-hidden="true" />
                    <div>
                      <strong>{alert.title}</strong>
                      <span>{alert.detail}</span>
                      <StatusBadge status={alert.level === 'critical' ? 'banned' : alert.level} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
