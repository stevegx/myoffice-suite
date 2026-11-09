import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { ErrorState } from '../components/ui/feedback'
import { ToolCard, type Tool } from './ToolCard'

const orderKey = 'myoffice.tool-order'

function readOrder(): string[] {
  try {
    const order: unknown = JSON.parse(localStorage.getItem(orderKey) ?? '[]')
    return Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function SortableTool({ tool }: { tool: Tool }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: tool.id })
  return (
    <li ref={setNodeRef} className={isDragging ? 'relative z-10 opacity-80' : undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}>
      <ToolCard tool={tool} handle={
        <Button variant="ghost" size="icon" className="absolute top-4 right-4 touch-none cursor-grab text-muted-foreground active:cursor-grabbing"
          title="Σύρε για αλλαγή σειράς"
          ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Μετακίνηση: ${tool.name}`}>
          <GripVertical size={19} aria-hidden="true" />
        </Button>
      } />
    </li>
  )
}

export default function SortableTools({ tools }: { tools: Tool[] }) {
  const [order, setOrder] = useState(readOrder)
  const [orderError, setOrderError] = useState(false)
  const byId = new Map(tools.map((tool) => [tool.id, tool]))
  const ids = [...new Set([...order.filter((id) => byId.has(id)), ...byId.keys()])]
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  return (
    <>
      {orderError && <ErrorState className="mb-4" title="Η σειρά των καρτών δεν αποθηκεύτηκε"
        detail="Η νέα σειρά ισχύει για όσο παραμένει ανοιχτό το μενού." />}
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        accessibility={{ screenReaderInstructions: { draggable: 'Πάτησε κενό για επιλογή, βέλη για μετακίνηση, κενό για τοποθέτηση ή Escape για ακύρωση.' } }}
        onDragEnd={({ active, over }) => {
          if (!over || active.id === over.id) return
          const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
          setOrder(next)
          try {
            localStorage.setItem(orderKey, JSON.stringify(next))
            setOrderError(false)
          } catch {
            setOrderError(true)
          }
        }}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <ul className="tool-grid">
            {ids.map((id) => <SortableTool key={id} tool={byId.get(id)!} />)}
          </ul>
        </SortableContext>
      </DndContext>
    </>
  )
}
