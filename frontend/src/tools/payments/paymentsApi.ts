export type Period = {
  start: string
  end: string
  erpStart: string
  erpEnd: string
  count: number
}

type Candidate = { code: string; name: string; date: string; cents: number }

export type PaymentRow = {
  row: number
  reference: string
  date: string
  name: string
  cents: number | null
  code: string
  isAdmin: boolean
  erpName: string
  candidateCount: number
  candidates: Candidate[]
}

export type MatchResult = {
  rows: PaymentRow[]
  erpFirst: string
  erpLast: string
  erpNamesByCode: Record<string, string[]>
}

export const money = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' })

export function searchKey(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('el')
}

export function dateLabel(value: string) {
  return value.split('-').reverse().join('/')
}

export function readUpload(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error('Το μέγιστο μέγεθος είναι 8 MB ανά αρχείο.'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Δεν ήταν δυνατή η ανάγνωση του αρχείου.'))
    reader.readAsDataURL(file)
  })
}

export async function paymentRequest(endpoint: string, data: object) {
  const response = await fetch(`/api/payments/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    cache: 'no-store',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Το αίτημα απέτυχε. Δοκίμασε ξανά.')
  }
  return response
}
