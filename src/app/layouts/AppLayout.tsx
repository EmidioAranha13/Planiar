import { Bell, CalendarDays, LogOut, Moon, Settings, Sun, Users } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { SyncIndicator } from '../../components/sync/SyncIndicator';
import { Button } from '../../components/ui/button';
import { getUserDb } from '../../db/dexie/database';
import { markNotificationRead, respondInvitation } from '../../db/repositories/local';
import { commit, syncNow } from '../../services/sync/engine';
import { startRealtime } from '../../services/realtime/client';
import { apiRequest } from '../../services/api/client';
import { useSessionStore } from '../../stores/sessionStore';
import { useSyncStore } from '../../stores/syncStore';
import { useUiStore } from '../../stores/uiStore';

export function AppLayout() {
  const user = useSessionStore((state) => state.user);
  const forget = useSessionStore((state) => state.forget);
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const conflicts = useSyncStore((state) => state.conflicts);
  const db = user ? getUserDb(user.id) : null;
  const notifications = useLiveQuery(() => (db ? db.notifications.orderBy('createdAt').reverse().toArray() : []), [db]);
  const unread = (notifications ?? []).filter((item) => !item.readAt).length;
  useEffect(() => {
    if (!user) return;
    const run = () => void syncNow(user.id);
    window.addEventListener('online', run);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(run, 15_000);
    const stopRealtime = startRealtime(user.id);
    return () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      void stopRealtime.then((stop) => stop());
    };
  }, [user]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <a className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-card focus:p-2" href="#conteudo">Pular para o conteúdo</a>
      <header className="pt-safe flex items-center gap-3 border-b border-border px-3 py-2">
        <Link to="/" className="font-semibold tracking-tight">Planiar</Link>
        <SyncIndicator />
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Alternar tema" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <details className="relative">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl hover:bg-accent" aria-label="Notificações">
              <Bell className="h-4 w-4" />
              {unread > 0 ? <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" /> : null}
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-border bg-card p-3 shadow-xl">
              {(notifications ?? []).slice(0, 8).map((notification) => (
                <article key={notification.id} className="border-b border-border py-2 text-sm last:border-0">
                  <p>{notificationLabel(notification.type, notification.payload)}</p>
                  <div className="mt-2 flex gap-2">
                    {notification.type === 'invitation_received' ? (
                      <>
                        <Button size="sm" onClick={() => user && void commit(() => respondInvitation(user.id, String(notification.payload.invitationId), 'accepted'), user.id)}>Aceitar</Button>
                        <Button size="sm" variant="outline" onClick={() => user && void commit(() => respondInvitation(user.id, String(notification.payload.invitationId), 'rejected'), user.id)}>Recusar</Button>
                      </>
                    ) : null}
                    {!notification.readAt && user ? <Button size="sm" variant="ghost" onClick={() => void commit(() => markNotificationRead(user.id, notification.id), user.id)}>Lida</Button> : null}
                  </div>
                </article>
              ))}
              {(notifications ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Sem notificações.</p> : null}
            </div>
          </details>
          <Button size="icon" variant="ghost" aria-label="Sair" onClick={() => void logout(forget)}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <div id="conteudo" className="flex min-h-0 flex-1 flex-col pb-16 md:pb-0">
        <Outlet />
      </div>
      <nav className="pb-safe fixed inset-x-0 bottom-0 flex border-t border-border bg-card md:hidden">
        <MobileLink to="/" icon={<CalendarDays className="h-4 w-4" />} label="Calendário" />
        <MobileLink to="/routines" icon={<Users className="h-4 w-4" />} label="Rotinas" />
        <MobileLink to="/conflicts" icon={<Bell className="h-4 w-4" />} label={`Alertas${conflicts ? ` ${conflicts}` : ''}`} />
        <MobileLink to="/settings" icon={<Settings className="h-4 w-4" />} label="Ajustes" />
      </nav>
    </div>
  );
}

function MobileLink({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} className={({ isActive }) => `flex flex-1 flex-col items-center gap-1 py-2 text-[11px] ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
      {icon}
      {label}
    </NavLink>
  );
}

function notificationLabel(type: string, payload: Record<string, unknown>): string {
  const routine = typeof payload.routineName === 'string' ? payload.routineName : 'rotina';
  const sender = typeof payload.senderName === 'string' ? payload.senderName : 'Alguém';
  if (type === 'invitation_received') return `${sender} convidou você para ${routine}.`;
  if (type === 'invitation_accepted') return `Seu convite para ${routine} foi aceito.`;
  if (type === 'invitation_rejected') return `Seu convite para ${routine} foi recusado.`;
  if (type === 'conflict_opened') return 'Há um conflito para resolver.';
  if (type === 'proposal_received') return 'Você recebeu uma proposta de horário.';
  if (type === 'proposal_accepted') return 'Sua proposta foi aceita.';
  if (type === 'proposal_rejected') return 'Sua proposta foi recusada. A disputa continua aberta.';
  return 'Nova atualização.';
}

async function logout(forget: () => void) {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    // A sessão local é encerrada mesmo se o servidor estiver indisponível.
  }
  forget();
}
