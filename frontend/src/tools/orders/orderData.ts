import { hundredths, minimumSkroutzPrice } from '../price-calculator/calculations'

export type Product = {
  sku: string
  name: string
  minBuy: number | null
  lastBuy: number | null
  offers: Record<string, number>
  availability: string
  marked: boolean
  duplicate?: boolean
}
export type Market = { price: number | null; shop: string; day: string }
export type Catalog = { products: Product[]; suppliers: string[]; market: Record<string, Market>; optimizer?: Record<string, number>; duplicates: number; persistent: boolean }
export type Field = 'minBuy' | 'lastBuy' | 'stock' | 'salesRecent' | 'salesOther' | 'skroutz'
export type SourceValues = Record<string, Partial<Record<Field, number | null>>>
export type Source = { values: SourceValues; conflicts: number; filename: string }
export type SourceKind = 'costs' | 'stock' | 'salesRecent' | 'salesOther' | 'skroutz'
export type Sources = Partial<Record<SourceKind, Source>>
export type Draft = {
  id: number
  product: Product
  listed: boolean
  name?: string
  offers: Record<string, number | null>
  supplier: string
  supplierEdited: boolean
  purchase: string
  purchaseEdited: boolean
  quantity: string
  vat: string
  notes: string
  manual: Partial<Record<Field, string>>
}

const euro = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 })
export const money = (units: number | null | undefined) => units == null ? '---' : euro.format(units / 10_000)
export const editPrice = (units: number | null | undefined) => units == null ? '' : String(units / 10_000).replace('.', ',')

export function bestOffer(offers: Record<string, number | null>, excluding = '') {
  let best: [string, number] | undefined
  for (const [supplier, price] of Object.entries(offers)) {
    if (supplier !== excluding && price !== null && (!best || price < best[1])) best = [supplier, price]
  }
  return best
}

export function newDraft(id: number, product: Product): Draft {
  const selected = bestOffer(product.offers)?.[0] ?? ''
  return { id, product, listed: true, supplier: selected, supplierEdited: false, offers: {}, purchase: editPrice(product.offers[selected]), purchaseEdited: false,
    quantity: '', vat: '17', notes: '', manual: {} }
}

export function effectiveOffers(row: Draft) {
  return Object.keys(row.offers).length ? { ...row.product.offers, ...row.offers } : row.product.offers
}

export function supplierPrice(row: Draft, supplier: string) {
  const key = supplier.trim()
  return Object.hasOwn(row.offers, key) ? row.offers[key] : Object.hasOwn(row.product.offers, key) ? row.product.offers[key] : null
}

export function withSupplier(row: Draft, supplier: string): Draft {
  return { ...row, supplier, purchase: editPrice(supplierPrice(row, supplier)), purchaseEdited: false }
}

export function withOffers(row: Draft, offers: Draft['offers']): Draft {
  const updated = { ...row, offers }
  return row.purchaseEdited ? updated : withSupplier(updated, row.supplier)
}

export function parseAmount(value: string, places: number, signed = false) {
  const text = value.trim().replace(',', '.')
  if (!/^-?\d{1,7}(?:\.\d{0,4})?$/.test(text) || (text.split('.')[1]?.length ?? 0) > places) return null
  const amount = Number(text)
  return signed || amount >= 0 ? amount : null
}

export function snapshot(row: Draft, sources: Sources, market: Market | undefined, optimizer: number | null = null) {
  const { product } = row
  const imported = (kind: SourceKind, key: Field, fallback: number | null = null) => {
    const dataset = sources[kind]
    return dataset ? dataset.values[product.sku]?.[key] ?? null : fallback
  }
  const get = (key: Field, value: number | null, isPrice = false) => {
    const manual = row.manual[key]
    if (manual === undefined) return value
    const amount = parseAmount(manual, isPrice ? 4 : 3, key === 'stock' || key === 'salesRecent' || key === 'salesOther')
    return amount === null || (isPrice && amount === 0) ? null : isPrice ? Math.round(amount * 10_000) : amount
  }
  const purchase = parseAmount(row.purchase, 4)
  const vat = hundredths(row.vat)
  const ownMin = purchase && vat !== null && vat <= 10_000n
    ? Number(minimumSkroutzPrice(BigInt(Math.round(purchase * 10_000)), vat, 100n)) * 100 : null
  const skroutz = get('skroutz', imported('skroutz', 'skroutz', optimizer), true)
  const minBuy = get('minBuy', imported('costs', 'minBuy', product.minBuy), true)
  const lastBuy = get('lastBuy', imported('costs', 'lastBuy', product.lastBuy), true)
  const check = (left: number | null, right: number | null) =>
    left === null || right === null ? 'Εκκρεμεί' : left <= right ? 'ΟΚ' : 'Έλεγχος'
  const asEuro = (units: number | null) => units === null ? null : units / 10_000
  return {
    sku: product.sku, name: (row.name ?? product.name).trim(), supplier: row.supplier.trim(), purchase,
    quantity: parseAmount(row.quantity, 0), vat: vat !== null && vat <= 10_000n ? Number(vat) / 10_000 : null,
    ownMin: asEuro(ownMin), skroutz: asEuro(skroutz), competitor: market?.price == null ? null : market.price / 100,
    competitorDay: market?.day ?? '', competitorShop: market?.shop ?? '',
    minBuy: asEuro(minBuy), lastBuy: asEuro(lastBuy), amardis: asEuro(supplierPrice(row, 'Amardis')), availability: product.availability,
    stock: get('stock', imported('stock', 'stock')),
    salesRecent: get('salesRecent', imported('salesRecent', 'salesRecent')),
    salesOther: get('salesOther', imported('salesOther', 'salesOther')),
    skrCheck: check(ownMin, skroutz),
    buyCheck: check(purchase && purchase > 0 ? Math.round(purchase * 10_000) : null, minBuy),
    notes: row.notes.trim(),
  }
}
