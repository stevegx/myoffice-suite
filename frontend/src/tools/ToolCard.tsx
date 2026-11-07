import { Activity, ArrowRight, ArrowUpRight, Package, Tags, UsersRound, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'

export type Tool = { id: string; name: string; description: string; externalUrl?: string }

export function ToolCard({ tool, handle }: { tool: Tool; handle?: ReactNode }) {
  const Icon = tool.externalUrl ? UsersRound : tool.id === 'products' ? Package : tool.id === 'repricing' ? Tags : tool.id === 'payments' ? Wallet : Activity
  const Arrow = tool.externalUrl ? ArrowUpRight : ArrowRight
  return (
    <div className="relative h-full min-w-0 overflow-hidden rounded-2xl border border-border/75 bg-card shadow-sm">
      <a className="group flex h-full min-h-52 min-w-0 flex-col items-start px-5 py-5 hover:bg-primary/5 focus-visible:-outline-offset-2 motion-safe:transition-colors"
        href={tool.externalUrl ?? `#/${tool.id}`}
        target={tool.externalUrl ? '_blank' : undefined}
        rel={tool.externalUrl ? 'noopener noreferrer' : undefined}>
        <span className="mb-4 grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon size={20} aria-hidden="true" />
        </span>
        <span className="font-semibold">{tool.name}</span>
        <span className="mt-1 text-sm leading-relaxed text-muted-foreground">{tool.description}</span>
        <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-medium text-primary">
          {tool.externalUrl ? 'Άνοιγμα σε νέα καρτέλα' : 'Άνοιγμα'}
          <Arrow size={16} className="shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </a>
      {handle}
    </div>
  )
}
