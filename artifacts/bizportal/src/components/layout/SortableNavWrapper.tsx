import { type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  children: ReactNode;
}

export function SortableNavWrapper({ id, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn("flex items-start gap-0.5", isDragging && "opacity-40 z-50")}
    >
      <span
        {...attributes}
        {...listeners}
        className="mt-1.5 shrink-0 cursor-grab active:cursor-grabbing touch-none p-0.5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
        title="Seret untuk memindahkan"
      >
        <GripVertical size={13} />
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
