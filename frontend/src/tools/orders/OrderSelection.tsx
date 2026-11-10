import { Button } from '../../components/ui/button'
import type { Draft } from './orderData'

export const orderCheckbox = 'size-4 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

export function SelectPage<T extends number | string>({ ids, checked, onSelect, disabled }: {
  ids: T[]; checked: ReadonlySet<T>; onSelect: (ids: T[], selected: boolean) => void; disabled?: boolean
}) {
  const count = ids.filter((id) => checked.has(id)).length
  const all = count === ids.length
  return <input type="checkbox" className={orderCheckbox} aria-label="Επιλογή γραμμών σε αυτή τη σελίδα" checked={all} disabled={disabled}
    ref={(input) => { if (input) input.indeterminate = count > 0 && !all }}
    onChange={(event) => onSelect(ids, event.currentTarget.checked)} />
}

export function ProductFields({ draft, onChange, onSkuChange }: {
  draft: Draft; onChange: (name: string) => void; onSkuChange: (value: string) => boolean
}) {
  const { sku, name } = draft.product
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <input key={sku} className="h-8 w-full min-w-0 rounded-md border border-border/65 bg-background px-2 text-xs font-semibold text-primary"
        aria-label={`SKU ${sku}`} defaultValue={sku} maxLength={80} onBlur={(event) => {
          const input = event.currentTarget
          if (input.value !== sku && !onSkuChange(input.value)) input.value = sku
          else input.value = input.value.trim()
        }} onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.value = sku
          if ((event.key === 'Enter' || event.key === 'Escape') && !event.nativeEvent.isComposing) event.currentTarget.blur()
        }} />
      <textarea key={draft.name ?? name} rows={2} className="block w-full resize-y rounded-md border border-border/65 bg-background px-2 py-1 text-xs font-medium"
        aria-label={`Περιγραφή ${sku}`} defaultValue={draft.name ?? name} maxLength={1024} aria-invalid={!(draft.name ?? name).trim() || undefined}
        onBlur={(event) => {
          if (event.currentTarget.value !== (draft.name ?? name)) onChange(event.currentTarget.value)
        }} />
    </div>
  )
}

export function BulkToolbar({ count, visible, selectedVisible, onAll, onEdit, onDelete, onClear, onAdd, addCount, deleteLabel = 'Μαζική διαγραφή', disabled }: {
  count: number; visible: number; selectedVisible: number; onAll: () => void; onEdit: () => void
  onDelete: () => void; onClear: () => void; onAdd?: () => void; addCount?: number
  deleteLabel?: string; disabled?: boolean
}) {
  if (!visible && !count) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/65 bg-primary/5 p-3">
      <div>
        <p role="status" className="text-sm font-semibold">{count ? `${count} επιλεγμένες γραμμές` : 'Μαζικές ενέργειες'}</p>
        <p className="text-xs text-muted-foreground">{count > selectedVisible
          ? `${count - selectedVisible} εκτός του φίλτρου.` : 'Χρησιμοποίησε τα checkbox για να επιλέξεις γραμμές.'}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-8" disabled={disabled || !visible || (count === visible && selectedVisible === visible)}
          onClick={onAll}>Επιλογή όλων στο φίλτρο · {visible}</Button>
        {!!count && <>
          {onAdd && <Button className="h-8" disabled={disabled || !addCount} onClick={onAdd}>
            {count > selectedVisible ? 'Προσθήκη επιλεγμένων στο φίλτρο' : 'Προσθήκη επιλεγμένων'} · {addCount}
          </Button>}
          <Button variant={onAdd ? 'outline' : 'default'} className="h-8" disabled={disabled} onClick={onEdit}>Μαζική επεξεργασία</Button>
          <Button variant="outline" className="h-8 text-red-700 dark:text-red-300" disabled={disabled} onClick={onDelete}>{deleteLabel}</Button>
          <Button variant="ghost" className="h-8" disabled={disabled} onClick={onClear}>Καθαρισμός επιλογής</Button>
        </>}
      </div>
    </div>
  )
}
