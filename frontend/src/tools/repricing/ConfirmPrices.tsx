import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { athensToday } from '../products/dates'
export type ExportedPrice = { sku: string; product: string; skr: number | null; site: number | null }

export function ConfirmPrices({ exports }: { exports: Partial<Record<'skroutz' | 'site', ExportedPrice[]>> }) {
  const [day, setDay] = useState(athensToday)
  const [skroutz, setSkroutz] = useState(false)
  const [site, setSite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const skrCount = exports.skroutz?.length ?? 0
  const siteCount = exports.site?.length ?? 0

  async function save() {
    if (!day || busy) return
    const rows = new Map<string, { sku: string; product: string; skroutz?: number | null; site?: number | null }>()
    if (skroutz) for (const row of exports.skroutz ?? []) rows.set(row.sku, { sku: row.sku, product: row.product, skroutz: row.skr })
    if (site) for (const row of exports.site ?? []) rows.set(row.sku, { ...rows.get(row.sku), sku: row.sku, product: row.product, site: row.site })
    if (!rows.size) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/products/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, rows: [...rows.values()] }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Η καταχώριση απέτυχε.')
      setNotice(`Καταχωρίστηκαν ${result.saved} νέες τιμές στο ιστορικό.`)
      setSkroutz(false)
      setSite(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Η καταχώριση απέτυχε.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="mt-4 rounded-xl border border-border/70 bg-card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Καταχώριση δημοσιευμένων τιμών στο ιστορικό</summary>
      <p className="mt-3 text-muted-foreground">Επιβεβαίωσε μόνο τα κανάλια όπου ανέβασες όλες τις τιμές του τελευταίου export.</p>
      {!skrCount && !siteCount && <p className="mt-2 text-muted-foreground">Κάνε πρώτα export των αλλαγών που θα ανεβάσεις.</p>}
      <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="text-sm">
          Ημερομηνία εφαρμογής
          <input type="date" className="mt-1 block h-9 rounded-lg border border-border bg-background px-2"
            value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <label className="flex h-9 items-center gap-2">
          <input type="checkbox" disabled={busy || !skrCount} checked={skroutz && !!skrCount}
            onChange={(event) => setSkroutz(event.target.checked)} /> Skroutz ({skrCount})
        </label>
        <label className="flex h-9 items-center gap-2">
          <input type="checkbox" disabled={busy || !siteCount} checked={site && !!siteCount}
            onChange={(event) => setSite(event.target.checked)} /> Site ({siteCount})
        </label>
        <Button className="h-9" disabled={busy || !day || !((skroutz && skrCount) || (site && siteCount))}
          onClick={() => void save()}>Καταχώριση στο ιστορικό</Button>
      </div>
      {notice && <p className="mt-3 text-primary" role="status">{notice}</p>}
      {error && <p className="mt-3 text-red-700 dark:text-red-300" role="alert">{error}</p>}
    </details>
  )
}
