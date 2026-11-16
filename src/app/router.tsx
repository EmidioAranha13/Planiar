import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './layouts/AppLayout';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '../features/auth/AuthPages';

const CalendarPage = lazy(() => import('../features/calendar/CalendarPage').then((module) => ({ default: module.CalendarPage })));
import { ActivitiesPage, ConflictsPage, InstallPage, ProfilePage, RoutinesPage, SettingsPage } from '../features/pages/SecondaryPages';
import type { CurrentUser } from '../domain/entities/types';
import { ApiError, apiRequest } from '../services/api/client';
import { syncNow } from '../services/sync/engine';
import { useSessionStore } from '../stores/sessionStore';

export function AppRouter() {
  return (
    <BrowserRouter>
      <SessionGate>
        <Routes>
          <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/install" element={<InstallPage />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route index element={<Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Abrindo o calendário…</p>}><CalendarPage /></Suspense>} />
            <Route path="activities" element={<ActivitiesPage />} />
            <Route path="routines" element={<RoutinesPage />} />
            <Route path="conflicts" element={<ConflictsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionGate>
    </BrowserRouter>
  );
}

function SessionGate({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const setUser = useSessionStore((state) => state.setUser);
  const remember = useSessionStore((state) => state.remember);
  const readRemembered = useSessionStore((state) => state.readRemembered);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await apiRequest<{ user: CurrentUser }>('/api/auth/me');
        if (cancelled) return;
        remember(result.user);
        void syncNow(result.user.id);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 0) {
          const remembered = readRemembered();
          setUser(remembered, remembered ? 'offline' : 'anonymous');
          return;
        }
        setUser(null, 'anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remember, readRemembered, setUser]);
  if (status === 'unknown') return <p className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Carregando o Planiar…</p>;
  return children;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return children;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  if (status === 'authenticated' || status === 'offline') return <Navigate to="/" replace />;
  return children;
}
