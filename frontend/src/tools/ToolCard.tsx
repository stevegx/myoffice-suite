import { Activity, ArrowLeftRight, ArrowRight, ArrowUpRight, Calculator, FileText, Package, Tags, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'

export type Tool = { id: string; name: string; description: string; externalUrl?: string }
export type ToolCardVariant = 'featured' | 'compact'

const icons: Record<string, typeof Activity | undefined> = {
  converter: ArrowLeftRight,
  'price-calculator': Calculator,
  products: Package,
  repricing: Tags,
  payments: Wallet,
}

export function ToolCard({ tool, variant, handle }: { tool: Tool; variant: ToolCardVariant; handle?: ReactNode }) {
  const featured = variant === 'featured'
  const Icon = tool.externalUrl ? FileText : icons[tool.id] ?? Activity
  const Arrow = tool.externalUrl ? ArrowUpRight : ArrowRight
  return (
    <div className={`tool-card tool-card--${variant}`} data-tool={tool.id}>
      <a className="group tool-card-link"
        href={tool.externalUrl ?? `#/${tool.id}`}
        target={tool.externalUrl ? '_blank' : undefined}
        rel={tool.externalUrl ? 'noopener noreferrer' : undefined}>
        <span className="tool-card-icon">
          <Icon size={featured ? 21 : 18} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="tool-card-title">{tool.name}</span>
          <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{tool.description}</span>
          {tool.externalUrl && <span className="mt-1.5 inline-block rounded-md border border-border/65 bg-primary/8 px-1.5 py-0.5 text-[10px] font-semibold">
            Εξωτερικό<span className="sr-only"> · ανοίγει σε νέα καρτέλα</span>
          </span>}
        </span>
        <span className="tool-card-action">
          {featured && 'Άνοιγμα'}
          <Arrow size={16} className="shrink-0 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </a>
      {handle}
    </div>
  )
}
