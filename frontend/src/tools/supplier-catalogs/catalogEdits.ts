import { parseAmount } from '../orders/orderData'
import type { SupplierRow } from './matching'

export type CatalogEdit = { price?: number | null; availability?: string; erpSku?: string }

export function editedPrice(row: SupplierRow, edit?: CatalogEdit) {
  return edit?.price === undefined ? row.price : edit.price
}

export function priceUnits(value: string) {
  const amount = parseAmount(value, 4)
  return amount && amount > 0 ? Math.round(amount * 10_000) : null
}
