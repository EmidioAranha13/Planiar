import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ActivityFormDialog } from '../../components/activities/ActivityFormDialog';
import { ActivityLibrary } from '../../components/activities/ActivityLibrary';
import { ColorField } from '../../components/activities/ColorField';
import { Button } from '../../components/ui/button';
import { Input, Label, Textarea } from '../../components/ui/field';
import { getUserDb } from '../../db/dexie/database';
import { deleteUserDb } from '../../db/dexie/database';
import { buildBackup, parseBackup } from '../../domain/rules/backup';
import { createRoutine, deleteRoutine, inviteMember, proposeResolution, removeMember, respondProposal, updateRoutine } from '../../db/repositories/local';
import type { HealthStatus, ProposalChanges, ScheduleConflict } from '../../domain/entities/types';
import { fiveMinuteTimes, isoToZonedParts, zonedDateTimeToIso } from '../../domain/rules/time';
import { apiRequest } from '../../services/api/client';
import { commit } from '../../services/sync/engine';
import { useSessionStore } from '../../stores/sessionStore';

export function ActivitiesPage() {
  const user = useSessionStore((state) => state.user);
  const [open, setOpen] = useState(false);
  const db = user ? getUserDb(user.id) : null;
  const activities = useLiveQuery(() => (db ? db.activities.filter((activity) => !activity.deletedAt).toArray() : []), [db]);
  if (!user) return null;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
      <ActivityLibrary activities={activities ?? []} onCreate={() => setOpen(true)} />
      <ActivityFormDialog userId={user.id} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function RoutinesPage() {
  const user = useSessionStore((state) => state.user);
  const db = user ? getUserDb(user.id) : null;
  const routines = useLiveQuery(() => (db ? db.routines.filter((routine) => !routine.deletedAt).toArray() : []), [db]);
  const members = useLiveQuery(() => (db ? db.members.toArray() : []), [db]);
  const [name, setName] = useState('Nova rotina');
  const [username, setUsername] = useState('');
  const [selected, setSelected] = useState<string>('');
  if (!user || !db) return null;
  const routine = (routines ?? []).find((item) => item.id === selected) ?? routines?.[0];
  const mine = (members ?? []).filter((member) => member.routineId === routine?.id);
  const isOwner = mine.some((member) => member.userId === user.id && member.role === 'owner');
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4">
      <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        void commit(() => createRoutine(user.id, { name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }), user.id);
      }}>
        <Input aria-label="Nome da rotina" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit">Criar</Button>
      </form>
      <div className="grid gap-3">
        {(routines ?? []).map((item) => (
          <button key={item.id} className={`rounded-2xl border p-4 text-left ${routine?.id === item.id ? 'border-primary' : 'border-border'}`} onClick={() => setSelected(item.id)}>
            <strong>{item.name}</strong>
            <p className="text-sm text-muted-foreground">{item.type === 'shared' ? 'Compartilhada' : 'Individual'} · {item.timezone} · sobreposição {item.overlapPolicy === 'allow' ? 'permitida' : 'abre disputa'}</p>
          </button>
        ))}
      </div>
      {routine && isOwner ? (
        <section className="space-y-3 rounded-2xl border border-border p-4">
          <h2 className="font-semibold">Gerenciar {routine.name}</h2>
          <Textarea defaultValue={routine.description} onBlur={(event) => void commit(() => updateRoutine(user.id, routine.id, { description: event.target.value }) as Promise<unknown>, user.id)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={routine.overlapPolicy === 'conflict'} onChange={(event) => void commit(() => updateRoutine(user.id, routine.id, { overlapPolicy: event.target.checked ? 'conflict' : 'allow' }) as Promise<unknown>, user.id)} />
            Tratar sobreposição inesperada como disputa
          </label>
          <form className="flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            void commit(() => inviteMember(user.id, routine.id, username), user.id).then(() => toast.success('Convite registrado para sincronização.'));
          }}>
            <Input aria-label="Usuário convidado" placeholder="nome de usuário" value={username} onChange={(event) => setUsername(event.target.value)} />
            <Button type="submit">Convidar</Button>
          </form>
          <p className="text-xs text-muted-foreground">Ao convidar alguém, a rotina passa a ser compartilhada.</p>
          <ul className="space-y-2 text-sm">
            {mine.map((member) => (
              <li key={member.id} className="flex items-center justify-between">
                <span>{member.role === 'owner' ? 'Proprietário' : 'Editor'}</span>
                {member.role !== 'owner' ? <Button size="sm" variant="outline" onClick={() => void commit(() => removeMember(user.id, member.id), user.id)}>Remover</Button> : null}
              </li>
            ))}
          </ul>
          <Button variant="destructive" onClick={() => void commit(() => deleteRoutine(user.id, routine.id), user.id)}>Excluir rotina</Button>
        </section>
      ) : null}
    </div>
  );
}

export function ConflictsPage() {
  const user = useSessionStore((state) => state.user);
  const db = user ? getUserDb(user.id) : null;
  const conflicts = useLiveQuery(() => (db ? db.conflicts.filter((conflict) => conflict.status !== 'resolved').toArray() : []), [db]);
  const proposals = useLiveQuery(() => (db ? db.proposals.toArray() : []), [db]);
  const routines = useLiveQuery(() => (db ? db.routines.toArray() : []), [db]);
  if (!user) return null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Disputas</h1>
      {(conflicts ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nenhum conflito aberto.</p> : null}
      {(conflicts ?? []).map((conflict) => (
        <ConflictCard
          key={conflict.id}
          userId={user.id}
          conflict={conflict}
          timezone={routines?.find((routine) => routine.id === conflict.routineId)?.timezone ?? 'UTC'}
          pending={(proposals ?? []).find((proposal) => proposal.conflictId === conflict.id && proposal.status === 'pending') ?? null}
        />
      ))}
    </div>
  );
}

function ConflictCard({
  userId,
  conflict,
  timezone,
  pending,
}: {
  userId: string;
  conflict: ScheduleConflict;
  timezone: string;
  pending: { id: string; proposerId: string; proposedChanges: ProposalChanges } | null;
}) {
  const [date, setDate] = useState(() => isoToZonedParts(new Date().toISOString(), timezone).date);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const times = fiveMinuteTimes();
  return (
    <article className="space-y-3 rounded-2xl border border-border p-4">
      <header className="flex items-center justify-between">
        <strong>{conflict.kind}</strong>
        <span className="text-xs text-muted-foreground">{conflict.status}</span>
      </header>
      <div className="grid gap-3 md:grid-cols-3">
        <StateCard title="Base" value={conflict.baseState} />
        <StateCard title="Servidor" value={conflict.serverState} />
        <StateCard title="Proposta local" value={conflict.proposedState} />
      </div>
      {pending ? <p className="text-sm">Proposta pendente: {JSON.stringify(pending.proposedChanges)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void commit(() => proposeResolution(userId, conflict.id, { action: 'keep', choice: 'server' }), userId)}>Manter servidor</Button>
        <Button size="sm" variant="outline" onClick={() => void commit(() => proposeResolution(userId, conflict.id, { action: 'keep', choice: 'proposed' }), userId)}>Manter minha alteração</Button>
        <Button size="sm" variant="outline" onClick={() => void commit(() => proposeResolution(userId, conflict.id, { action: 'delete_all' }), userId)}>Excluir envolvidos</Button>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault();
        const scheduleId = conflict.affectedScheduleIds[0];
        if (!scheduleId) return;
        const changes: ProposalChanges = {
          action: 'reschedule',
          scheduleId,
          startAt: zonedDateTimeToIso(date, start, timezone),
          endAt: zonedDateTimeToIso(date, end, timezone),
        };
        void commit(() => proposeResolution(userId, conflict.id, changes), userId);
      }}>
        <label className="text-sm"><Label>Nova data</Label>
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="text-sm"><Label>Novo início</Label>
          <select className="h-10 rounded-xl border border-input bg-card px-2" value={start} onChange={(event) => setStart(event.target.value)}>{times.map((time) => <option key={time}>{time}</option>)}</select>
        </label>
        <label className="text-sm"><Label>Novo fim</Label>
          <select className="h-10 rounded-xl border border-input bg-card px-2" value={end} onChange={(event) => setEnd(event.target.value)}>{times.map((time) => <option key={time}>{time}</option>)}</select>
        </label>
        <Button size="sm" type="submit">Propor horário</Button>
      </form>
      {pending && pending.proposerId !== userId ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void commit(() => respondProposal(userId, pending.id, 'accepted'), userId)}>Aceitar</Button>
          <Button size="sm" variant="outline" onClick={() => void commit(() => respondProposal(userId, pending.id, 'rejected'), userId)}>Recusar</Button>
        </div>
      ) : null}
    </article>
  );
}

function StateCard({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-xl bg-muted p-3 text-xs">
      <p className="mb-1 font-semibold">{title}</p>
      <pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function ProfilePage() {
  const user = useSessionStore((state) => state.user);
  const remember = useSessionStore((state) => state.remember);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [color, setColor] = useState(user?.profileColor ?? '#0F766E');
  if (!user) return null;
  return (
    <form className="mx-auto max-w-lg space-y-4 p-4" onSubmit={(event) => {
      event.preventDefault();
      void apiRequest<{ user: typeof user }>('/api/auth/profile', { method: 'PATCH', body: { displayName, profileColor: color } })
        .then((result) => {
          remember(result.user);
          toast.success('Perfil atualizado.');
        })
        .catch((error: Error) => toast.error(error.message));
    }}>
      <h1 className="text-2xl font-semibold">Perfil</h1>
      <div className="space-y-1"><Label>Nome</Label><Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
      <div className="space-y-1"><Label>Usuário</Label><Input value={user.username} disabled /></div>
      <div className="space-y-1"><Label>E-mail</Label><Input value={user.email} disabled /></div>
      <ColorField color={color} onChange={setColor} label="Cor de identificação" preview={displayName || 'Você'} />
      <Button type="submit">Salvar perfil</Button>
    </form>
  );
}

export function SettingsPage() {
  const user = useSessionStore((state) => state.user);
  const forget = useSessionStore((state) => state.forget);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [backupMessage, setBackupMessage] = useState('');
  if (!user) return null;
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Ajustes</h1>
      <Link className="text-primary" to="/install">Como instalar o aplicativo</Link>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void apiRequest<HealthStatus>('/api/health').then(setHealth).catch((error: Error) => toast.error(error.message))}>Ver integrações</Button>
        <Button variant="outline" onClick={() => void exportBackup(user.id)}>Exportar histórico local</Button>
        <Button variant="destructive" onClick={() => void clearDevice(user.id, forget)}>Sair e limpar este dispositivo</Button>
      </div>
      {health ? (
        <ul className="space-y-1 text-sm">
          <li>Banco: {health.database}</li>
          <li>E-mail: {health.emailConfigured ? 'Resend configurado' : 'não configurado'}</li>
          <li>Tempo real: {health.realtimeConfigured ? 'Ably configurado' : 'somente atualização periódica'}</li>
          <li>Imagens: {health.storage === 'blob' ? 'Vercel Blob' : 'PostgreSQL criptografado'}</li>
          <li>Criptografia de mídia: {health.mediaEncryption ? 'ativa' : 'inativa'}</li>
          <li>Exclusão de histórico remoto: desativada</li>
        </ul>
      ) : null}
      <label className="block space-y-1 text-sm">
        Validar arquivo de backup
        <Input type="file" accept="application/json" onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const parsed = parseBackup(JSON.parse(await file.text()));
          setBackupMessage(parsed.ok ? `Arquivo válido. ${parsed.counts.schedules} agendamentos. A importação ainda não está habilitada.` : parsed.message);
        }} />
      </label>
      {backupMessage ? <p className="text-sm">{backupMessage}</p> : null}
    </div>
  );
}

async function exportBackup(userId: string) {
  const db = getUserDb(userId);
  const backup = buildBackup({
    userId,
    exportedAt: new Date().toISOString(),
    activities: await db.activities.toArray(),
    routines: await db.routines.toArray(),
    schedules: await db.schedules.toArray(),
    conflicts: await db.conflicts.toArray(),
  });
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'planiar-backup.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function clearDevice(userId: string, forget: () => void) {
  const db = getUserDb(userId);
  const pending = (await db.operations.toArray()).filter((operation) => operation.status === 'pending' || operation.status === 'error');
  const confirmed = window.confirm(pending.length > 0
    ? `Há ${pending.length} alteração(ões) não sincronizada(s). Apagar os dados deste dispositivo mesmo assim?`
    : 'Apagar os dados locais deste dispositivo?');
  if (!confirmed) return;
  await deleteUserDb(userId);
  try { await apiRequest('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* sessão já pode ter expirado */ }
  forget();
}

export function InstallPage() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Instalar o Planiar</h1>
      {prompt ? <Button onClick={() => void prompt.prompt()}>Instalar no Android</Button> : <p>No Android, use o menu do navegador e escolha instalar ou adicionar à tela inicial.</p>}
      {ios ? <p>No iPhone ou iPad, abra o compartilhamento do Safari e toque em Adicionar à Tela de Início.</p> : null}
      <p className="text-sm text-muted-foreground">O aplicativo funciona offline depois da primeira visita. Os dados ficam neste dispositivo até a sincronização.</p>
      <Link className="text-primary" to="/login">Ir para o login</Link>
    </main>
  );
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };
