import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ColorField } from '../../components/activities/ColorField';
import { Button } from '../../components/ui/button';
import { Input, Label } from '../../components/ui/field';
import { profileFromUser, seedAccount } from '../../db/repositories/local';
import type { CurrentUser, Routine, RoutineMember } from '../../domain/entities/types';
import { parseImageDataUrl } from '../../domain/rules/image';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from '../../domain/schemas/auth';
import { ApiError, apiRequest } from '../../services/api/client';
import { syncNow } from '../../services/sync/engine';
import { useSessionStore } from '../../stores/sessionStore';

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <p className="text-sm font-semibold tracking-wide text-primary uppercase">Planiar</p>
      <h1 className="mt-2 text-3xl font-semibold">{title}</h1>
      <div className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-sm">{children}</div>
    </main>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const remember = useSessionStore((state) => state.remember);
  const form = useForm({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await apiRequest<{ user: CurrentUser }>('/api/auth/login', { method: 'POST', body: values });
      remember(result.user);
      await syncNow(result.user.id);
      navigate('/');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Não foi possível entrar.');
    }
  });
  return (
    <AuthCard title="Entrar">
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1"><Label htmlFor="username">Usuário</Label><Input id="username" autoComplete="username" {...form.register('username')} /></div>
        {form.formState.errors.username ? <p className="text-sm text-destructive">{form.formState.errors.username.message}</p> : null}
        <div className="space-y-1"><Label htmlFor="password">Senha</Label><Input id="password" type="password" autoComplete="current-password" {...form.register('password')} /></div>
        {form.formState.errors.password ? <p className="text-sm text-destructive">{form.formState.errors.password.message}</p> : null}
        <Button className="w-full" type="submit">Entrar</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link className="text-primary" to="/forgot-password">Esqueci a senha</Link>
        <Link className="text-primary" to="/register">Criar conta</Link>
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const remember = useSessionStore((state) => state.remember);
  const [color, setColor] = useState('#0F766E');
  const [avatar, setAvatar] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
      displayName: '',
      profileColor: '#0F766E',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      avatarDataUrl: null,
    },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await apiRequest<{ user: CurrentUser; routine: Routine; member: RoutineMember }>('/api/auth/register', {
        method: 'POST',
        body: { ...values, profileColor: color, avatarDataUrl: avatar },
      });
      await seedAccount(result.user.id, result.routine, result.member, profileFromUser(result.user));
      remember(result.user);
      navigate('/');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Não foi possível criar a conta.');
    }
  });
  return (
    <AuthCard title="Criar conta">
      <form className="space-y-3" onSubmit={onSubmit}>
        <div className="space-y-1"><Label htmlFor="displayName">Nome</Label><Input id="displayName" {...form.register('displayName')} /></div>
        <div className="space-y-1"><Label htmlFor="new-username">Usuário</Label><Input id="new-username" {...form.register('username')} /></div>
        <div className="space-y-1"><Label htmlFor="email">E-mail</Label><Input id="email" type="email" {...form.register('email')} /></div>
        <div className="space-y-1"><Label htmlFor="new-password">Senha</Label><Input id="new-password" type="password" {...form.register('password')} /></div>
        <div className="space-y-1"><Label htmlFor="confirm">Confirmar senha</Label><Input id="confirm" type="password" {...form.register('confirmPassword')} /></div>
        {Object.values(form.formState.errors)[0]?.message ? <p className="text-sm text-destructive">{Object.values(form.formState.errors)[0]?.message}</p> : null}
        <ColorField color={color} onChange={setColor} label="Cor de identificação" preview={form.watch('displayName') || 'Você'} />
        <div className="space-y-1">
          <Label htmlFor="avatar">Foto de perfil</Label>
          <Input id="avatar" type="file" accept="image/png,image/jpeg,image/webp" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const dataUrl = await fileToDataUrl(file);
            const parsed = parseImageDataUrl(dataUrl);
            if (!parsed.ok) {
              toast.error(parsed.message);
              return;
            }
            setAvatar(dataUrl);
          }} />
        </div>
        <Button className="w-full" type="submit">Criar conta e abrir o calendário</Button>
      </form>
      <Link className="mt-4 block text-sm text-primary" to="/login">Já tenho conta</Link>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const form = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const [devLink, setDevLink] = useState<string | null>(null);
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiRequest('/api/auth/forgot-password', { method: 'POST', body: values });
      toast.success('Se o e-mail existir, enviaremos as instruções.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'email_not_configured') {
        const link = typeof error.details?.devResetUrl === 'string' ? error.details.devResetUrl : null;
        setDevLink(link);
        toast.error('O serviço de e-mail não está configurado. Nenhum e-mail foi enviado.');
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Não foi possível iniciar a recuperação.');
    }
  });
  return (
    <AuthCard title="Recuperar senha">
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1"><Label htmlFor="recover-email">E-mail</Label><Input id="recover-email" type="email" {...form.register('email')} /></div>
        <Button className="w-full" type="submit">Enviar link</Button>
      </form>
      {devLink ? <p className="mt-4 text-sm">Ambiente de desenvolvimento, sem envio real: <Link className="text-primary" to={devLink.replace(window.location.origin, '')}>abrir redefinição</Link></p> : null}
      <Link className="mt-4 block text-sm text-primary" to="/login">Voltar</Link>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: params.get('token') ?? '', password: '', confirmPassword: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await apiRequest('/api/auth/reset-password', { method: 'POST', body: values });
      toast.success('Senha redefinida. Entre novamente.');
      navigate('/login');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível redefinir a senha.');
    }
  });
  return (
    <AuthCard title="Nova senha">
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-1"><Label htmlFor="reset-password">Nova senha</Label><Input id="reset-password" type="password" {...form.register('password')} /></div>
        <div className="space-y-1"><Label htmlFor="reset-confirm">Confirmar senha</Label><Input id="reset-confirm" type="password" {...form.register('confirmPassword')} /></div>
        {Object.values(form.formState.errors)[0]?.message ? <p className="text-sm text-destructive">{Object.values(form.formState.errors)[0]?.message}</p> : null}
        <Button className="w-full" type="submit">Salvar senha</Button>
      </form>
    </AuthCard>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
    reader.readAsDataURL(file);
  });
}
