"use client"

/**
 * Drag-and-drop step list used by /recipes/new and /recipes/[id]/edit.
 *
 * The consumer holds the steps as `{ id, text }[]` (the `id` is a stable
 * client-side UUID minted when the step is added — it never reaches the
 * server). On drop the component returns the reordered array; consumers
 * persist that on submit by mapping `.text`.
 *
 * Sensors:
 *   - Pointer with an 8 px activation distance so a click on the trash /
 *     a focus into the textarea doesn't accidentally drag the row.
 *   - Touch with a 200 ms delay + 8 px tolerance for the same reason on
 *     mobile (tapping to type vs. pressing-and-holding to reorder).
 *   - Keyboard so arrow keys with focus on the drag handle still work.
 *
 * The drag handle is a dedicated `GripVertical` icon column; the textarea
 * itself is NOT a drag source so typing/editing never triggers a drag.
 */
import { useId } from "react"
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
import { GripVertical, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface StepDraft {
  id: string
  text: string
}

/** Mint a new step row with a stable client-side id. */
export function makeStep(text: string = ""): StepDraft {
  // crypto.randomUUID is the modern, secure path; fall back so older runtimes
  // (unit tests under jsdom without polyfill, mostly) don't crash.
  const uid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return { id: uid, text }
}

interface Props {
  steps: StepDraft[]
  onReorder: (next: StepDraft[]) => void
  onChange: (id: string, value: string) => void
  onRemove: (id: string) => void
  /** Optional per-step error hint keyed by index in the current order. */
  errorAt?: (idx: number) => string | null | undefined
}

export function SortableStepsList({
  steps,
  onReorder,
  onChange,
  onRemove,
  errorAt,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ona:dnd-start"))
    }
  }

  function endDrag() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("ona:dnd-end"))
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    endDrag()
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = steps.findIndex((s) => s.id === active.id)
    const newIndex = steps.findIndex((s) => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onReorder(arrayMove(steps, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={endDrag}
    >
      <SortableContext
        items={steps.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {steps.map((step, idx) => (
            <SortableStepRow
              key={step.id}
              step={step}
              index={idx}
              hint={errorAt?.(idx) ?? null}
              removable={steps.length > 1}
              onChange={onChange}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableStepRow({
  step,
  index,
  hint,
  removable,
  onChange,
  onRemove,
}: {
  step: StepDraft
  index: number
  hint: string | null
  removable: boolean
  onChange: (id: string, value: string) => void
  onRemove: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id })
  const textareaId = useId()

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Reordenar paso"
          className="mt-2 cursor-grab touch-none rounded p-1 text-[#7A7066] transition-colors hover:bg-[#F2EDE0] hover:text-[#1A1612] active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </button>
        <span className="font-display mt-1 text-[1.4rem] leading-none text-[#C65D38]/40">
          {String(index + 1).padStart(2, "0")}
        </span>
        <textarea
          id={textareaId}
          value={step.text}
          onChange={(e) => onChange(step.id, e.target.value)}
          placeholder={`Paso ${index + 1}`}
          rows={2}
          className={cn(
            "flex-1 resize-none rounded-lg border bg-[#F2EDE0] px-3 py-2 text-[14px] leading-relaxed text-[#1A1612] placeholder:text-[#7A7066] focus:outline-none focus:ring-1",
            hint
              ? "border-[#C65D38] focus:border-[#C65D38] focus:ring-[#C65D38]"
              : "border-[#DDD6C5] focus:border-[#1A1612] focus:ring-[#1A1612]",
          )}
        />
        <button
          type="button"
          onClick={() => onRemove(step.id)}
          disabled={!removable}
          className="mt-1 rounded p-1 text-[#7A7066] hover:text-[#C65D38] disabled:opacity-30"
          aria-label="Quitar paso"
        >
          <Trash2 size={16} />
        </button>
      </div>
      {hint && <p className="pl-9 text-[11px] italic text-[#C65D38]">{hint}</p>}
    </div>
  )
}
