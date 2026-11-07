import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('glass rounded-3xl border border-border bg-card/65 text-card-foreground', className)} {...props} />
}
