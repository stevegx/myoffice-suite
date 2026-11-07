import { useId } from 'react'
import { Button } from '../../components/ui/button'
import { dateLabel, money, type PaymentRow } from './paymentsApi'
import { popoverSurface, useAnchoredPopover } from './useAnchoredPopover'

export function PaymentCandidates({ row, onCode, disabled }: {
  row: PaymentRow
  onCode: (code: string) => void
  disabled: boolean
}) {
  const id = useId()
  const { panel, trigger, close } = useAnchoredPopover()

  return (
    <>
      <Button ref={trigger} variant="outline" className="h-8 shrink-0 px-2 text-xs text-primary"
        popoverTarget={id} aria-label={`${row.candidateCount} πιθανοί κωδικοί για τη γραμμή ${row.row}`}
        disabled={disabled}>
        {row.candidateCount} επιλογές
      </Button>
      <div ref={panel} id={id} popover="auto" role="dialog" aria-label="Πιθανοί κωδικοί"
        className={`${popoverSurface} gap-2`}>
        <p className="shrink-0 font-semibold">Πιθανοί κωδικοί ERP</p>
        <ul className="min-h-12 space-y-1 overflow-y-auto overscroll-contain">
          {row.candidates.map((candidate) => (
            <li key={candidate.code}>
              <button type="button" className="grid w-full min-w-0 gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-primary/10"
                onClick={() => {
                  onCode(candidate.code)
                  close()
                }}>
                <span className="truncate font-semibold text-primary" title={candidate.code}>{candidate.code}</span>
                <span className="truncate" title={candidate.name}>{candidate.name}</span>
                <span className="text-xs text-muted-foreground">{dateLabel(candidate.date)} · {money.format(candidate.cents / 100)}</span>
              </button>
            </li>
          ))}
        </ul>
        {row.candidateCount > row.candidates.length && (
          <p className="shrink-0 text-xs text-muted-foreground">Εμφανίζονται οι πρώτοι {row.candidates.length}.</p>
        )}
      </div>
    </>
  )
}
