import { Funnel } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../../components/ui/button'
import { searchKey } from './paymentsApi'
import { popoverSurface, useAnchoredPopover } from './useAnchoredPopover'

type Props = {
  title: string
  getValues: () => string[]
  selected: Set<string> | undefined
  label: (value: string) => string
  onApply: (selection?: Set<string>) => void
  onGroup?: () => void
}

const displayLimit = 150
const blank = '(Κενά)'

export function ColumnFilter({ title, getValues, selected, label, onApply, onGroup }: Props) {
  const id = useId()
  const { panel, trigger, close } = useAnchoredPopover()
  const [search, setSearch] = useState('')
  const [values, setValues] = useState<string[]>([])
  const [draft, setDraft] = useState<Set<string>>(() => new Set())
  const [limit, setLimit] = useState(displayLimit)
  const term = searchKey(search.trim())
  const visible = term ? values.filter((value) => searchKey(value ? label(value) : blank).includes(term)) : values
  const allChecked = visible.length > 0 && visible.every((value) => draft.has(value))

  function finish(selection?: Set<string>) {
    onApply(selection)
    close()
  }

  function applySelection() {
    const selection = term ? new Set(visible.filter((value) => draft.has(value))) : draft
    finish(values.every((value) => selection.has(value)) ? undefined : selection)
  }

  return (
    <>
      <Button ref={trigger} variant={selected ? 'default' : 'ghost'} size="icon" className="size-8"
        aria-label={`Φίλτρο: ${title}`} title={`Φίλτρο: ${title}`} popoverTarget={id}
        onClick={() => {
          const element = panel.current
          if (!element || element.matches(':popover-open')) return
          const nextValues = getValues()
          setValues(nextValues)
          setSearch('')
          setLimit(displayLimit)
          setDraft(new Set(selected === undefined ? nextValues : nextValues.filter((value) => selected.has(value))))
        }}>
        <Funnel size={15} aria-hidden="true" />
      </Button>
      <div ref={panel} id={id} popover="auto" role="dialog" aria-label={`Τιμές για ${title}`}
        className={`${popoverSurface} gap-2`}>
        <div className="shrink-0 space-y-2">
          <p className="truncate font-semibold" title={title}>{title}</p>
          <input type="search" aria-label="Αναζήτηση τιμών" placeholder="Αναζήτηση τιμών"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2"
            value={search} onChange={(event) => {
              setSearch(event.target.value)
              setLimit(displayLimit)
            }} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) applySelection()
            }} />
          <label className="flex items-center gap-2 rounded-lg bg-primary/8 px-2.5 py-1.5 font-medium">
            <input type="checkbox" checked={allChecked} disabled={!visible.length}
              onChange={(event) => {
                const next = new Set(draft)
                for (const value of visible) {
                  if (event.target.checked) next.add(value)
                  else next.delete(value)
                }
                setDraft(next)
              }} />
            {term ? 'Όλα τα αποτελέσματα' : 'Επιλογή όλων'}
          </label>
        </div>
        <div className="min-h-12 flex-1 overflow-y-auto overscroll-contain rounded-lg border border-border p-1.5" tabIndex={0}
          role="group" aria-label="Διαθέσιμες τιμές">
          {visible.slice(0, limit).map((value) => (
            <label key={value} className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 hover:bg-primary/8">
              <input type="checkbox" className="shrink-0" checked={draft.has(value)} onChange={(event) => {
                const next = new Set(draft)
                if (event.target.checked) next.add(value)
                else next.delete(value)
                setDraft(next)
              }} />
              <span className="min-w-0 truncate" title={value ? label(value) : blank}>{value ? label(value) : blank}</span>
            </label>
          ))}
          {!visible.length && <p className="py-1 text-muted-foreground">Καμία τιμή.</p>}
          {visible.length > limit && (
            <Button variant="ghost" className="mt-1 h-8 w-full" onClick={() => setLimit(limit + displayLimit)}>
              Περισσότερες τιμές
            </Button>
          )}
        </div>
        <div className="shrink-0">
          {(values.includes('') || onGroup) && <div className="mb-1 flex flex-wrap justify-between gap-1">
            {values.includes('') && <Button variant="ghost" className="h-7 px-2" onClick={() => finish(new Set(['']))}>Μόνο κενά</Button>}
            {onGroup && <Button variant="ghost" className="h-7 px-2" onClick={() => { onGroup(); close() }}>Ομαδοποίηση</Button>}
          </div>}
          <div className="flex justify-between gap-2">
            <Button variant="outline" className="h-8" onClick={() => finish()}>Εκκαθάριση</Button>
            <Button className="h-8" onClick={applySelection}>Εφαρμογή</Button>
          </div>
        </div>
      </div>
    </>
  )
}
