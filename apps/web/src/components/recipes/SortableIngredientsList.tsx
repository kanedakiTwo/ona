"use client"

/**
 * Drag-and-drop ingredient list — sibling of `SortableStepsList`. Used
 * inside /recipes/new and /recipes/[id]/edit so users can reorder the
 * ingredient table the same way they reorder steps.
 *
 * Layout note: an ingredient row is wider than a step row (autocomplete +
 * quantity + unit + opc toggle + trash) so the grip handle replaces the
 * step row's chapter-number column on the left.
 *
 * Sensor mirror of the steps list: 8 px PointerSensor distance, 200 ms
 * TouchSensor delay, KeyboardSensor for accessibility. The handle is the
 * only drag source so clicking the autocomplete / typing a quantity never
 * starts a drag.
 */
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"
import type { ReactNode } from "react"

/**
 * Every ingredient row needs a stable client-side id to anchor the React
 * key + the dnd-kit sortable id. We don't reuse the server-issued
 * recipe_ingredient.id because new rows added in the form don't have one
 * yet — keep this purely form-local and merge with the server payload at
 * submit time (the consumer strips `rowId` before sending).
 */
export interface SortableRowAnchor {
  rowId: string
}

interface Props<R extends SortableRowAnchor> {
  rows: R[]
  onReorder: (next: R[]) => void
  /**
   * Render the actual content of a row — autocomplete, qty, unit, opc,
   * trash — without the grip handle (the wrapper adds that). The
   * `dragging` flag lets the consumer fade or hide the row preview while
   * it's being dragged.
   */
  renderRow: (row: R, dragging: boolean) => ReactNode
}

export function SortableIngredientsList<R extends SortableRowAnchor>({
  rows,
  onReorder,
  renderRow,
}: Props<R>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rows.findIndex((r) => r.rowId === active.id)
    const newIndex = rows.findIndex((r) => r.rowId === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onReorder(arrayMove(rows, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={rows.map((r) => r.rowId)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {rows.map((row) => (
            <SortableIngredientRow key={row.rowId} row={row} renderRow={renderRow} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableIngredientRow<R extends SortableRowAnchor>({
  row,
  renderRow,
}: {
  row: R
  renderRow: (row: R, dragging: boolean) => ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.rowId })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Reordenar ingrediente"
        className="mt-2 cursor-grab touch-none rounded p-1 text-[#7A7066] transition-colors hover:bg-[#F2EDE0] hover:text-[#1A1612] active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>
      <div className="flex-1">{renderRow(row, isDragging)}</div>
    </div>
  )
}

/** Mint a new row anchor id. Match the steps list helper. */
export function makeRowId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
