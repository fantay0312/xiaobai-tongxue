import { Plus, Trash2 } from 'lucide-react'
import { majorToMinor, minorToMajor } from '../lib/format'
import type { BillingCycle, PlanPrice } from '../types/admin'
import { Field, formStyles } from './forms'
import { Button } from './ui'
import pageStyles from '../styles/Page.module.css'

export const emptyPrice: PlanPrice = {
  currency: 'CNY',
  amountMinor: '0',
  billingPeriod: 'monthly',
  bonusPoints: '0',
}

interface PriceEditorProps {
  prices: PlanPrice[]
  onChange: (prices: PlanPrice[]) => void
}

export function PriceEditor({ prices, onChange }: PriceEditorProps) {
  function update(index: number, field: keyof PlanPrice, value: string) {
    onChange(prices.map((price, priceIndex) => {
      if (priceIndex !== index) return price
      if (field === 'amountMinor') {
        return { ...price, amountMinor: majorToMinor(value) ?? price.amountMinor }
      }
      if (field === 'durationDays') {
        const parsed = Number(value)
        return {
          ...price,
          durationDays: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined,
        }
      }
      return { ...price, [field]: value }
    }))
  }

  return (
    <section className={pageStyles.drawerSection}>
      <h3>价格版本</h3>
      <div className={pageStyles.priceList}>
        {prices.map((price, index) => (
          <div className={pageStyles.priceRow} key={`${index}-${price.billingPeriod}`}>
            <Field label="金额">
              <input
                className={formStyles.input}
                type="number"
                min="0"
                step="0.01"
                value={minorToMajor(price.amountMinor)}
                onChange={(event) => update(index, 'amountMinor', event.target.value)}
                aria-label={`第 ${index + 1} 个价格金额`}
                required
              />
            </Field>
            <Field label="币种">
              <select
                className={formStyles.select}
                value={price.currency}
                onChange={(event) => update(index, 'currency', event.target.value)}
                aria-label={`第 ${index + 1} 个价格币种`}
              >
                <option value="CNY">CNY</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="计费周期">
              <select
                className={formStyles.select}
                value={price.billingPeriod}
                onChange={(event) => update(index, 'billingPeriod', event.target.value as BillingCycle)}
                aria-label={`第 ${index + 1} 个计费周期`}
              >
                <option value="free">免费</option>
                <option value="monthly">每月</option>
                <option value="quarterly">每季</option>
                <option value="yearly">每年</option>
                <option value="lifetime">永久</option>
                <option value="custom">自定义</option>
              </select>
            </Field>
            <Field label="有效天数">
              <input
                className={formStyles.input}
                type="number"
                min="1"
                value={price.durationDays ?? ''}
                onChange={(event) => update(index, 'durationDays', event.target.value)}
                aria-label={`第 ${index + 1} 个价格有效天数`}
                placeholder="按需"
              />
            </Field>
            <Field label="赠送积分">
              <input
                className={formStyles.input}
                inputMode="numeric"
                pattern="[0-9]*"
                value={price.bonusPoints}
                onChange={(event) => update(index, 'bonusPoints', event.target.value)}
                aria-label={`第 ${index + 1} 个价格赠送积分`}
              />
            </Field>
            <Button
              type="button"
              variant="quiet"
              icon={<Trash2 size={16} />}
              iconOnly
              aria-label={`删除第 ${index + 1} 个价格`}
              disabled={prices.length === 1}
              onClick={() => onChange(prices.filter((_, itemIndex) => itemIndex !== index))}
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        icon={<Plus size={16} />}
        onClick={() => onChange([...prices, { ...emptyPrice }])}
      >
        添加价格
      </Button>
    </section>
  )
}
