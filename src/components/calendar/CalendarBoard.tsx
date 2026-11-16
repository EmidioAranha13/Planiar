import { useEffect, useRef, useState, type RefObject } from 'react';
import FullCalendar, { type CalendarRef } from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import ptBr from '@fullcalendar/react/locales/pt-br';
import '@fullcalendar/react/themes/classic/theme.css';
import type { Activity, Routine, Schedule } from '../../domain/entities/types';
import { textColorForBackground } from '../../domain/rules/color';
import { rangesOverlap } from '../../domain/rules/time';
import { Trash2 } from 'lucide-react';

type CalendarView = 'timeGridWeek' | 'dayGridMonth';

type Props = {
  routine: Routine;
  schedules: Schedule[];
  activities: Activity[];
  canEdit: boolean;
  view: CalendarView;
  calendarRef: RefObject<CalendarRef | null>;
  onCreate: (start: string, end: string, activityId?: string) => void;
  onMove: (scheduleId: string, start: string, end: string) => void;
  onOpen: (scheduleId: string, mode: 'view' | 'edit') => void;
  onTrash: (scheduleId: string) => void;
};

export function CalendarBoard({ routine, schedules, activities, canEdit, view, calendarRef, onCreate, onMove, onOpen, onTrash }: Props) {
  const trashRef = useRef<HTMLDivElement | null>(null);
  const trashHit = useRef(false);
  const [dragging, setDragging] = useState(false);
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const events = schedules
    .filter((schedule) => !schedule.deletedAt && schedule.routineId === routine.id)
    .map((schedule) => {
      const activity = activityById.get(schedule.activityId);
      const color = activity?.color ?? '#64748B';
      return {
        id: schedule.id,
        title: activity?.title ?? 'Atividade',
        start: schedule.startAt,
        end: schedule.endAt,
        backgroundColor: color,
        borderColor: color,
        textColor: textColorForBackground(color),
        editable: canEdit,
      };
    });

  useEffect(() => {
    calendarRef.current?.getApi().changeView(view);
  }, [calendarRef, view]);

  const overlaps = (start: Date, end: Date, ignoreId?: string) => {
    if (routine.overlapPolicy !== 'conflict') return false;
    return schedules.some(
      (schedule) =>
        schedule.id !== ignoreId &&
        !schedule.deletedAt &&
        schedule.routineId === routine.id &&
        rangesOverlap(start.toISOString(), end.toISOString(), schedule.startAt, schedule.endAt),
    );
  };

  return (
    <div className="relative min-h-0 flex-1">
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView={view}
        locale={ptBr}
        firstDay={1}
        timeZone={routine.timezone}
        headerToolbar={false}
        height="100%"
        allDaySlot={false}
        nowIndicator
        slotDuration="00:30:00"
        snapDuration="00:05:00"
        scrollTime="07:00:00"
        eventMinHeight={18}
        dayMaxEvents={3}
        selectable={canEdit}
        selectMirror
        editable={canEdit}
        eventOverlap={routine.overlapPolicy === 'allow'}
        longPressDelay={250}
        events={events}
        selectAllow={(selection) => !overlaps(selection.start, selection.end)}
        eventAllow={(dropInfo, dragged) => !overlaps(dropInfo.start, dropInfo.end, dragged?.id)}
        select={(info) => {
          onCreate(info.startStr, info.endStr);
          info.view.calendar.unselect();
        }}
        eventClick={(info) => onOpen(info.event.id, coarse || info.jsEvent.detail >= 2 ? 'edit' : 'view')}
        eventDragStart={() => setDragging(true)}
        eventDragStop={(info) => {
          setDragging(false);
          const rect = trashRef.current?.getBoundingClientRect();
          const point = info.jsEvent;
          if (!rect || !('clientX' in point)) return;
          const inside = point.clientX >= rect.left && point.clientX <= rect.right && point.clientY >= rect.top && point.clientY <= rect.bottom;
          if (inside) {
            trashHit.current = true;
            onTrash(info.event.id);
          }
        }}
        eventDrop={(info) => {
          if (trashHit.current) {
            trashHit.current = false;
            info.revert();
            return;
          }
          if (!info.event.start || !info.event.end) {
            info.revert();
            return;
          }
          onMove(info.event.id, info.event.start.toISOString(), info.event.end.toISOString());
        }}
        eventResize={(info) => {
          if (!info.event.start || !info.event.end) {
            info.revert();
            return;
          }
          onMove(info.event.id, info.event.start.toISOString(), info.event.end.toISOString());
        }}
        eventReceive={(info) => {
          const activityId = info.event.extendedProps.activityId as string | undefined;
          if (info.event.start) {
            const end = info.event.end ?? new Date(info.event.start.getTime() + 30 * 60 * 1000);
            onCreate(info.event.start.toISOString(), end.toISOString(), activityId);
          }
          info.event.remove();
        }}
      />
      {dragging ? (
        <div
          ref={trashRef}
          className="absolute right-4 bottom-4 z-20 flex items-center gap-2 rounded-2xl border border-destructive bg-card px-4 py-3 text-sm text-destructive shadow-lg"
        >
          <Trash2 className="h-4 w-4" />
          Solte aqui para excluir
        </div>
      ) : null}
    </div>
  );
}

