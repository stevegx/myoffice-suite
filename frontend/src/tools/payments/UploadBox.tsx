import { Check, UploadCloud } from 'lucide-react'
import { useState } from 'react'

type Props = {
  label: string
  step: number
  accept: string
  filename?: string
  disabled: boolean
  waiting?: boolean
  onFile: (file: File) => void
}

export function UploadBox({ label, step, accept, filename, disabled, waiting, onFile }: Props) {
  const [hovering, setHovering] = useState(false)
  return (
      <label className={`relative flex min-h-24 min-w-0 items-center gap-3 px-4 py-4 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-primary motion-safe:transition-colors sm:gap-5 sm:px-6 ${disabled ? 'opacity-65' : 'cursor-pointer hover:bg-primary/5'} ${hovering && !disabled ? 'bg-primary/12' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
          if (!disabled) setHovering(true)
        }}
        onDragLeave={() => setHovering(false)}
        onDrop={(event) => {
          event.preventDefault()
          setHovering(false)
          const file = event.dataTransfer.files[0]
          if (!disabled && file) onFile(file)
        }}>
        <input type="file" accept={accept} disabled={disabled} aria-label={`${step}. ${label}`}
          className="sr-only" onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) onFile(file)
          }} />
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">
          {filename ? <Check size={18} /> : String(step).padStart(2, '0')}
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="truncate font-semibold">{label}</span>
          <span className="truncate text-sm text-muted-foreground" title={filename}>
            {filename || (waiting ? 'Ανέβασε πρώτα την πληρωμή Skroutz.' : `Σύρε ή επίλεξε αρχείο ${accept}`)}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-xs font-medium text-primary sm:px-3" aria-hidden="true">
          <UploadCloud size={16} /> <span className="hidden sm:inline">{filename ? 'Αλλαγή' : 'Επιλογή'}</span>
        </span>
      </label>
  )
}
