import { jsonOptions, requestJson } from '../../api/request'

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
  if (!file.size) return Promise.reject(new Error('Το αρχείο είναι κενό. Επίλεξε άλλο αρχείο.'))
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error('Το μέγιστο μέγεθος είναι 8 MB ανά αρχείο.'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = () => reject(new Error('Δεν ήταν δυνατή η ανάγνωση του αρχείου.'))
    reader.onabort = () => reject(new Error('Η ανάγνωση του αρχείου διακόπηκε.'))
    reader.readAsDataURL(file)
  })
}

export function paymentRequest<T>(endpoint: string, data: object) {
  return requestJson<T>(`/api/payments/${endpoint}`, jsonOptions(data))
}
