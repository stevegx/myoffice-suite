import { searchKey } from '../payments/paymentsApi'
import type { Product } from '../orders/orderData'

export type SupplierRow = {
  key: string
  code: string
  name: string
  volume: number | null
  price: number | null
  previousPrice: number | null
  existing: boolean
  availability: string
  source: string
  erpSku: string
}

function millilitres(name: string) {
  const values = [...name.matchAll(/(\d+(?:[.,]\d+)?)\s*(ml|cl|lit|lt|l)\b/gi)]
  const match = values.at(-1)
  return match ? Math.round(Number(match[1].replace(',', '.')) * ({ ml: 1, cl: 10 }[match[2].toLowerCase()] ?? 1000)) : null
}

function identity(name: string) {
  const text = searchKey(name)
  if (/\b(?:johnnie|jw)\b.*\bblack(?:\s+label\b|\s*(?:i\.?)?$)/.test(text)
    && !/\b(?:double|sherry|special\w*|gift|decant\w*|mini\w*|ruby|squids?)\b/.test(text)) return 'black'
  if (/\bgrey\s+goose\b/.test(text)
    && !/\b(?:altius|essences?|summer\w*|poire|citron|orange|strawberry|watermelon|peach|night|vanill\w*|melon|mini\w*)\b/.test(text)) return 'grey'
}

export function preferredProducts(products: Product[]) {
  const matches = products.filter(({ name }) => millilitres(name) === 700)
  const black = matches.filter(({ name }) => identity(name) === 'black' && /\bnrf\b/i.test(name))
  const grey = matches.filter(({ name }) => identity(name) === 'grey' && /\bimport(?:ed)?\b|\(\s*i\s*\)/i.test(name))
  return { black: black.length === 1 ? black[0] : undefined, grey: grey.length === 1 ? grey[0] : undefined }
}

export function preferredSku(row: SupplierRow, preferred: ReturnType<typeof preferredProducts>) {
  const kind = identity(row.name)
  return row.volume === 700 && kind ? preferred[kind]?.sku : undefined
}

export function suggestedProducts(row: SupplierRow, products: Product[]) {
  const terms = searchKey(row.name).match(/[a-z\p{L}]{3,}/gu)?.filter((word) => word !== 'vodka' && word !== 'whisky') ?? []
  return products.flatMap((product) => {
    const text = searchKey(product.name)
    const size = millilitres(product.name)
    if (row.volume && size && row.volume !== size) return []
    const hits = terms.filter((word) => text.includes(word)).length
    if (!hits || hits < Math.min(2, terms.length)) return []
    return [{ product, score: hits * 4 + Number(size === row.volume) * 2 }]
  }).sort((a, b) => b.score - a.score).slice(0, 8).map(({ product }) => product)
}
