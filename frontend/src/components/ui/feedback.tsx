import { CircleAlert, Info, LoaderCircle, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Button } from './button'

const surface = 'min-w-0 rounded-xl border px-4 py-3 text-sm leading-relaxed'

export function LoadingState({ title, rows = 0, className }: { title: string; rows?: number; className?: string }) {
  return (
    <div role="status" className={cn(surface, 'border-primary/20 bg-primary/8', className)}>
      <p className="flex items-center gap-2.5 font-medium">
        <LoaderCircle size={18} className="shrink-0 text-primary motion-safe:animate-spin" aria-hidden="true" />
        {title}
      </p>
      {rows > 0 && <div className="mt-4 grid gap-2 motion-safe:animate-pulse" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-10 items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/70 px-3">
            <span className="h-2.5 w-2/5 rounded-full bg-primary/15" />
            <span className="h-2.5 w-1/5 rounded-full bg-primary/10" />
          </div>
        ))}
      </div>}
    </div>
  )
}

export function ErrorState({ title, detail, retry, children, className }: {
  title: string; detail?: string; retry?: () => void; children?: ReactNode; className?: string
}) {
  return (
    <div className={cn(surface, 'border-red-500/25 bg-red-500/8', className)}>
      <div role="alert" className="flex min-w-0 items-start gap-2.5">
        <CircleAlert size={18} className="mt-0.5 shrink-0 text-red-700 dark:text-red-300" aria-hidden="true" />
        <div className="min-w-0 wrap-break-word">
          <p className="font-semibold text-red-800 dark:text-red-200">{title}</p>
          {detail && <p className="mt-0.5 text-muted-foreground">{detail}</p>}
        </div>
      </div>
      {(retry || children) && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
        {retry && <Button variant="outline" className="h-8" onClick={retry}><RotateCw size={15} aria-hidden="true" /> Δοκίμασε ξανά</Button>}
        {children}
      </div>}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={cn(surface, 'flex items-start gap-2.5 border-border/70 bg-card/70 text-muted-foreground')}>
    <Info size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" /> {children}
  </p>
}
