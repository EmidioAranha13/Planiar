import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { CalendarRef } from '@fullcalendar/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ActivityFormDialog } from '../../components/activities/ActivityFormDialog';
import { ActivityLibrary } from '../../components/activities/ActivityLibrary';
import { ActivityTag } from '../../components/activities/ActivityTag';
import { CalendarBoard } from '../../components/calendar/CalendarBoard';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { Input, Label } from '../../components/ui/field';
import { getUserDb } from '../../db/dexie/database';
import { createSchedule, deleteSchedules, updateSchedule } from '../../db/repositories/local';
import type { DeleteScope, Schedule } from '../../domain/entities/types';
import { schedulesInScope, deleteScopeLabels } from '../../domain/rules/deletion';
import { canEditSchedules } from '../../domain/rules/permissions';
import { summarizeMinutes } from '../../domain/rules/stats';
import { fiveMinuteTimes, formatDuration, isoToZonedParts, validateScheduleRange, zonedDateTimeToIso, zonedWeekRange } from '../../domain/rules/time';
import { commit } from '../../services/sync/engine';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';

export function CalendarPage() {
  const user = useSessionStore((state) => state.user);
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const routineId = useUiStore((state) => state.routineId);
  const setRoutineId = useUiStore((state) => state.setRoutineId);
  const selectedActivityId = useUiStore((state) => state.selectedActivityId);
  const [activityOpen, setActivityOpen] = useState(false);
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<{ start: string; end: string; activityId?: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const calendarRef = useRef<CalendarRef | null>(null);
  const userId = user?.id ?? '';
  const db = user ? getUserDb(user.id) : null;
  const routines = useLiveQuery(() => (db ? db.routines.filter((routine) => !routine.deletedAt).toArray() : []), [db]);
  const members = useLiveQuery(() => (db ? db.members.toArray() : []), [db]);
  const activities = useLiveQuery(() => (db ? db.activities.filter((activity) => !activity.deletedAt && activity.ownerId === userId).toArray() : []), [db, userId]);
  const schedules = useLiveQuery(() => (db ? db.schedules.toArray() : []), [db]);
  const routine = routines?.find((item) => item.id === routineId) ?? routines?.[0];
  const role = members?.find((member) => member.routineId === routine?.id && member.userId === userId)?.role ?? null;
  const canEdit = canEditSchedules(role);

  useEffect(() => {
    if (routine && routine.id !== routineId) setRoutineId(routine.id);
  }, [routine, routineId, setRoutineId]);

  const visibleSchedules = useMemo(
    () => (schedules ?? []).filter((schedule) => schedule.routineId === routine?.id && !schedule.deletedAt),
    [schedules, routine?.id],
  );
  const summary = useMemo(() => {
    if (!routine) return [];
    const week = zonedWeekRange(new Date(), routine.timezone);
    return summarizeMinutes({
      schedules: schedules ?? [],
      activities: activities ?? [],
      rangeStart: week.start.toISOString(),
      rangeEnd: week.end.toISOString(),
    });
  }, [activities, routine, schedules]);

  if (!user || !db) return null;

  const openCreate = (start: string, end: string, activityId?: string) => {
    setScheduleId(null);
    setScheduleMode('edit');
    setDraft({ start, end, activityId: activityId ?? selectedActivityId ?? undefined });
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="hidden w-80 shrink-0 flex-col gap-4 border-r border-border p-4 md:flex">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Rotina</span>
          <select
            className="h-10 w-full rounded-xl border border-input bg-card px-3"
            value={routine?.id ?? ''}
            onChange={(event) => setRoutineId(event.target.value)}
          >
            {(routines ?? []).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <ActivityLibrary activities={activities ?? []} onCreate={() => setActivityOpen(true)} />
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Nesta semana</h3>
          {summary.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum horário acumulado.</p> : null}
          {summary.slice(0, 4).map((item) => (
            <div key={item.activityId} className="flex items-center justify-between gap-2">
              <ActivityTag title={item.title} color={item.color} />
              <span className="text-xs text-muted-foreground">{formatDuration(item.minutes)}</span>
            </div>
          ))}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <Button size="icon" variant="outline" aria-label="Período anterior" onClick={() => calendarRef.current?.getApi().prev()}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" aria-label="Próximo período" onClick={() => calendarRef.current?.getApi().next()}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => calendarRef.current?.getApi().today()}>Hoje</Button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant={view === 'timeGridWeek' ? 'default' : 'outline'} onClick={() => setView('timeGridWeek')}>Semana</Button>
            <Button size="sm" variant={view === 'dayGridMonth' ? 'default' : 'outline'} onClick={() => setView('dayGridMonth')}>Mês</Button>
            <Button size="sm" onClick={() => openCreate(new Date().toISOString(), new Date(Date.now() + 30 * 60_000).toISOString())}>
              <Plus className="h-4 w-4" /> Agendar
            </Button>
          </div>
        </div>
        {routine ? (
          <CalendarBoard
            calendarRef={calendarRef}
            view={view}
            routine={routine}
            schedules={visibleSchedules}
            activities={activities ?? []}
            canEdit={canEdit}
            onCreate={openCreate}
            onMove={(id, start, end) => {
              void commit(() => updateSchedule(user.id, id, { startAt: start, endAt: end }), user.id).then((result) => {
                if (!result.ok) toast.error(result.message);
              });
            }}
            onOpen={(id, mode) => {
              setDraft(null);
              setScheduleId(id);
              setScheduleMode(mode);
            }}
            onTrash={(id) => {
              setScheduleId(id);
              setDeleteOpen(true);
            }}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Crie uma rotina para começar.</p>
        )}
      </section>
      <ActivityFormDialog userId={user.id} open={activityOpen} onOpenChange={setActivityOpen} />
      {routine ? (
        <ScheduleDialog
          userId={user.id}
          routineTimezone={routine.timezone}
          canEdit={canEdit}
          activities={activities ?? []}
          schedule={(schedules ?? []).find((item) => item.id === scheduleId) ?? null}
          draft={draft}
          mode={scheduleMode}
          open={Boolean(scheduleId || draft)}
          onOpenChange={(open) => {
            if (!open) {
              setScheduleId(null);
              setDraft(null);
            }
          }}
          onDelete={() => setDeleteOpen(true)}
        />
      ) : null}
      <DeleteDialog
        open={deleteOpen}
        schedule={(schedules ?? []).find((item) => item.id === scheduleId) ?? null}
        schedules={schedules ?? []}
        timezone={routine?.timezone ?? 'UTC'}
        onOpenChange={setDeleteOpen}
        onConfirm={async (scope) => {
          if (!scheduleId) return;
          const result = await commit(() => deleteSchedules(user.id, { anchorId: scheduleId, scope }), user.id);
          if (!result.ok) toast.error(result.message);
          else toast.success(`${result.count} agendamento(s) excluído(s).`);
          setDeleteOpen(false);
          setScheduleId(null);
          setDraft(null);
        }}
      />
    </div>
  );
}

function ScheduleDialog({
  userId,
  routineTimezone,
  canEdit,
  activities,
  schedule,
  draft,
  mode,
  open,
  onOpenChange,
  onDelete,
}: {
  userId: string;
  routineTimezone: string;
  canEdit: boolean;
  activities: { id: string; title: string; color: string; description: string }[];
  schedule: Schedule | null;
  draft: { start: string; end: string; activityId?: string } | null;
  mode: 'view' | 'edit';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const source = schedule ?? null;
  const initial = source
    ? isoToZonedParts(source.startAt, routineTimezone)
    : draft
      ? isoToZonedParts(draft.start, routineTimezone)
      : isoToZonedParts(new Date().toISOString(), routineTimezone);
  const initialEnd = source
    ? isoToZonedParts(source.endAt, routineTimezone)
    : draft
      ? isoToZonedParts(draft.end, routineTimezone)
      : initial;
  const [date, setDate] = useState(initial.date);
  const [start, setStart] = useState(initial.time);
  const [end, setEnd] = useState(initialEnd.time);
  const [activityId, setActivityId] = useState(source?.activityId ?? draft?.activityId ?? activities[0]?.id ?? '');
  const [editing, setEditing] = useState(mode === 'edit');
  useEffect(() => {
    const nextStart = source
      ? isoToZonedParts(source.startAt, routineTimezone)
      : draft
        ? isoToZonedParts(draft.start, routineTimezone)
        : isoToZonedParts(new Date().toISOString(), routineTimezone);
    const nextEnd = source
      ? isoToZonedParts(source.endAt, routineTimezone)
      : draft
        ? isoToZonedParts(draft.end, routineTimezone)
        : nextStart;
    setDate(nextStart.date);
    setStart(nextStart.time);
    setEnd(nextEnd.time);
    setActivityId(source?.activityId ?? draft?.activityId ?? activities[0]?.id ?? '');
    setEditing(mode === 'edit' || !source);
  }, [source?.id, source?.startAt, source?.endAt, source?.activityId, draft?.start, draft?.end, draft?.activityId, mode, routineTimezone, activities[0]?.id]);
  const activity = activities.find((item) => item.id === activityId);
  const startAt = zonedDateTimeToIso(date, start, routineTimezone);
  const endAt = zonedDateTimeToIso(date, end, routineTimezone);
  const range = validateScheduleRange({ startAt, endAt, timezone: routineTimezone });
  const times = fiveMinuteTimes();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{activity?.title ?? 'Agendamento'}</DialogTitle>
        <DialogDescription>{editing ? 'Ajuste o horário em intervalos de 5 minutos.' : 'Detalhes do agendamento.'}</DialogDescription>
        <div className="mt-4 space-y-3">
          {activity ? <ActivityTag title={activity.title} color={activity.color} /> : null}
          {activity?.description ? <p className="text-sm text-muted-foreground">{activity.description}</p> : null}
          <label className="block space-y-1 text-sm"><Label>Atividade</Label>
            <select className="h-10 w-full rounded-xl border border-input bg-card px-3" value={activityId} disabled={!editing} onChange={(event) => setActivityId(event.target.value)}>
              {activities.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm"><Label>Data</Label><Input type="date" value={date} disabled={!editing} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-sm"><Label>Início</Label>
              <select className="h-10 w-full rounded-xl border border-input bg-card px-3" value={start} disabled={!editing} onChange={(event) => setStart(event.target.value)}>
                {times.map((time) => <option key={time}>{time}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm"><Label>Fim</Label>
              <select className="h-10 w-full rounded-xl border border-input bg-card px-3" value={end} disabled={!editing} onChange={(event) => setEnd(event.target.value)}>
                {times.map((time) => <option key={time}>{time}</option>)}
              </select>
            </label>
          </div>
          <p className="text-sm">{range.ok ? `Duração: ${formatDuration(range.minutes)}` : range.message}</p>
          {source ? <p className="text-xs text-muted-foreground">Alterado por {source.updatedByName}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            {source && canEdit ? <Button variant="destructive" onClick={onDelete}>Excluir</Button> : null}
            {canEdit && !editing ? <Button onClick={() => setEditing(true)}>Editar</Button> : null}
            {canEdit && editing ? (
              <Button
                disabled={!range.ok || !activityId}
                onClick={() => {
                  void commit(async () => {
                    if (source) return updateSchedule(userId, source.id, { startAt, endAt, activityId });
                    const user = useSessionStore.getState().user;
                    return createSchedule(userId, {
                      routineId: useUiStore.getState().routineId ?? '',
                      activityId,
                      startAt,
                      endAt,
                      timezone: routineTimezone,
                      updatedByName: user?.displayName ?? 'Você',
                    });
                  }, userId).then((result) => {
                    if (!result.ok) toast.error(result.message);
                    else {
                      toast.success('Agendamento salvo.');
                      onOpenChange(false);
                    }
                  });
                }}
              >
                Salvar
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  schedule,
  schedules,
  timezone,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  schedule: Schedule | null;
  schedules: Schedule[];
  timezone: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scope: DeleteScope) => Promise<void>;
}) {
  const [scope, setScope] = useState<DeleteScope>('one');
  if (!schedule) return null;
  const count = schedulesInScope({ schedules, anchor: schedule, scope, timeZone: timezone }).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Excluir agendamentos</DialogTitle>
        <DialogDescription>Esta ação pede confirmação e sincroniza o lote inteiro.</DialogDescription>
        <div className="mt-4 space-y-2">
          {(Object.keys(deleteScopeLabels) as DeleteScope[]).map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm">
              <input type="radio" name="scope" checked={scope === item} onChange={() => setScope(item)} />
              {deleteScopeLabels[item]} ({schedulesInScope({ schedules, anchor: schedule, scope: item, timeZone: timezone }).length})
            </label>
          ))}
          <p className="text-sm text-muted-foreground">{count} agendamento(s) serão excluídos.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => void onConfirm(scope)}>Confirmar exclusão</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
