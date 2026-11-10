import { money } from '../payments/paymentsApi'
import type { Price } from './PriceChart'

export type Offer = { supplier: string; price: number | null; availability: string; day: string | null }
export type Product = {
  sku: string
  name: string
  erpName: string | null
  skroutzName: string | null
  legacyName: string | null
  skroutz: number | null
  site: number | null
  minimum: number | null
  minimumSource: 'erp' | 'repricing' | null
  minimumDay: string | null
  optimizer: number | null
  minBuy: number | null
  lastBuy: number | null
  bestOffer: Offer | null
}
export type Catalog = { enabled: boolean; items: Product[]; total: number; pageSize: number }
export type ProductDetail = Product & { prices: Price[]; offers: Offer[] }

const precise = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 })
export const salePrice = (cents: number | null | undefined) => cents == null ? '—' : money.format(cents / 100)
export const unitPrice = (units: number | null | undefined) => units == null ? '—' : precise.format(units / 10_000)
