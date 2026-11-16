import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Activity } from '../../domain/entities/types';
import { useUiStore } from '../../stores/uiStore';
import { useActivityDraggable } from '../calendar/activityDraggable';
import { Button } from '../ui/button';
import { ActivityTag } from './ActivityTag';

function SortableActivity({
  activity,
  selected,
  onSelect,
}: {
  activity: Activity;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: activity.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-xl border px-2 py-2 ${selected ? 'border-primary bg-accent' : 'border-transparent bg-card'}`}
    >
      <button
        type="button"
        className="cursor-grab rounded-md p-1 text-muted-foreground"
        aria-label={`Reordenar ${activity.title}`}
        onPointerDown={(event) => event.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        data-activity-id={activity.id}
        data-activity-title={activity.title}
        data-activity-color={activity.color}
        className="min-w-0 flex-1 text-left"
        onClick={onSelect}
      >
        <ActivityTag title={activity.title} color={activity.color} className="max-w-full" />
        {activity.description ? <p className="mt-1 truncate text-xs text-muted-foreground">{activity.description}</p> : null}
      </button>
    </div>
  );
}

export function ActivityLibrary({
  activities,
  onCreate,
}: {
  activities: Activity[];
  onCreate: () => void;
}) {
  const selected = useUiStore((state) => state.selectedActivityId);
  const setSelected = useUiStore((state) => state.setSelectedActivityId);
  const order = useUiStore((state) => state.activityOrder);
  const setOrder = useUiStore((state) => state.setActivityOrder);
  const [items, setItems] = useState<string[] | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useActivityDraggable(listRef, true);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const ids = items ?? [...activities].sort((a, b) => {
    const left = order.indexOf(a.id);
    const right = order.indexOf(b.id);
    if (left === -1 && right === -1) return a.title.localeCompare(b.title, 'pt-BR');
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
  }).map((activity) => activity.id);
  const byId = new Map(activities.map((activity) => [activity.id, activity]));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    const next = arrayMove(ids, oldIndex, newIndex);
    setItems(next);
    setOrder(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Atividades</h2>
        <Button size="sm" variant="outline" onClick={onCreate}>
          <Plus className="h-4 w-4" /> Nova
        </Button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div ref={listRef} className="space-y-1 overflow-y-auto pr-1">
            {ids.map((id) => {
              const activity = byId.get(id);
              if (!activity) return null;
              return (
                <SortableActivity
                  key={activity.id}
                  activity={activity}
                  selected={selected === activity.id}
                  onSelect={() => setSelected(activity.id)}
                />
              );
            })}
            {activities.length === 0 ? <p className="text-sm text-muted-foreground">Crie uma atividade para arrastá-la ao calendário.</p> : null}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
