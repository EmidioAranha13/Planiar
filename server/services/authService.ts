import { and, eq, isNull } from 'drizzle-orm';
import type { CurrentUser, Routine, RoutineMember } from '../../src/domain/entities/types';
import {
  forgotPasswordSchema,
  loginSchema,
  passwordChangeSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
} from '../../src/domain/schemas/auth';
import { isValidTimeZone } from '../../src/domain/rules/time';
import type { Database } from '../database/client';
import { passwordResets, routines, routineMembers, sessions, users } from '../database/schema';
import { AppError } from '../http/errors';
import { clearSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from '../security/cookies';
import { hashPassword, verifyPassword, verifyPasswordOrDummy } from '../security/password';
import { consumeRateLimit, loginRateLimit } from '../security/rateLimit';
import { createToken, hashToken } from '../security/tokens';
import { emailConfigured, sendPasswordReset } from './email';
import { storeAvatar } from './media';
import { addChange, audit, toCurrentUser, toMember, toProfile, toRoutine, type SyncContext } from './syncContext';

const SESSION_SECONDS = 60 * 60 * 24 * 30;

function zodError(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Os dados enviados são inválidos.';
}

async function createSession(db: Database, userId: string, meta: { ip: string; userAgent: string | null }): Promise<string> {
  const token = createToken();
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db.insert(sessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: expires,
    createdAt: new Date().toISOString(),
    revokedAt: null,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  return token;
}

export async function registerUser(
  db: Database,
  input: unknown,
  meta: { ip: string; userAgent: string | null },
): Promise<{ user: CurrentUser; routine: Routine; member: RoutineMember; cookie: string }> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'validation', zodError(parsed.error));
  if (!isValidTimeZone(parsed.data.timezone)) throw new AppError(400, 'validation', 'Informe um fuso horário válido.');
  const usernameTaken = await db.select({ id: users.id }).from(users).where(eq(users.username, parsed.data.username));
  if (usernameTaken[0]) throw new AppError(409, 'username_taken', 'Este nome de usuário já está em uso.');
  const emailTaken = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email));
  if (emailTaken[0]) throw new AppError(409, 'email_taken', 'Este e-mail já está em uso.');
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  let avatarUrl: string | null = null;
  if (parsed.data.avatarDataUrl) avatarUrl = await storeAvatar(db, userId, parsed.data.avatarDataUrl);
  const row = {
    id: userId,
    username: parsed.data.username,
    email: parsed.data.email,
    passwordHash: await hashPassword(parsed.data.password),
    displayName: parsed.data.displayName.trim(),
    profileColor: parsed.data.profileColor,
    avatarUrl,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(users).values(row);
  const routineRow = {
    id: crypto.randomUUID(),
    name: 'Minha rotina',
    description: '',
    ownerId: userId,
    type: 'personal' as const,
    color: parsed.data.profileColor,
    timezone: parsed.data.timezone,
    overlapPolicy: 'allow' as const,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const memberRow = {
    id: crypto.randomUUID(),
    routineId: routineRow.id,
    userId,
    role: 'owner' as const,
    joinedAt: now,
  };
  await db.insert(routines).values(routineRow);
  await db.insert(routineMembers).values(memberRow);
  const ctx: SyncContext = { db, actorId: userId, now, audience: new Set() };
  await addChange(ctx, { entityType: 'routine', entityId: routineRow.id, op: 'upsert', record: toRoutine(routineRow), version: 1, audienceUserIds: [userId] });
  await addChange(ctx, { entityType: 'member', entityId: memberRow.id, op: 'upsert', record: toMember(memberRow), version: null, audienceUserIds: [userId] });
  await addChange(ctx, { entityType: 'profile', entityId: userId, op: 'upsert', record: toProfile(row), version: null, audienceUserIds: [userId] });
  await audit(ctx, 'auth.register', 'user', userId);
  const token = await createSession(db, userId, meta);
  return { user: toCurrentUser(row), routine: toRoutine(routineRow), member: toMember(memberRow), cookie: sessionCookie(token, SESSION_SECONDS) };
}

export async function loginUser(
  db: Database,
  input: unknown,
  meta: { ip: string; userAgent: string | null },
): Promise<{ user: CurrentUser; cookie: string }> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'validation', zodError(parsed.error));
  const limits = loginRateLimit();
  const identity = await consumeRateLimit(db, `login:${meta.ip}:${parsed.data.username}`, limits.identity, limits.windowMs);
  const ipLimit = await consumeRateLimit(db, `login-ip:${meta.ip}`, limits.ip, limits.windowMs);
  if (!identity.allowed || !ipLimit.allowed) {
    throw new AppError(429, 'rate_limited', 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  }
  const rows = await db.select().from(users).where(eq(users.username, parsed.data.username));
  const user = rows[0];
  const valid = await verifyPasswordOrDummy(parsed.data.password, user?.passwordHash ?? null);
  if (!user || !valid) throw new AppError(401, 'invalid_credentials', 'Usuário ou senha inválidos.');
  const token = await createSession(db, user.id, meta);
  return { user: toCurrentUser(user), cookie: sessionCookie(token, SESSION_SECONDS) };
}

export async function logoutUser(db: Database, cookieHeader: string | undefined): Promise<string> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (token) {
    await db.update(sessions).set({ revokedAt: new Date().toISOString() }).where(eq(sessions.tokenHash, hashToken(token)));
  }
  return clearSessionCookie();
}

export async function currentUser(db: Database, cookieHeader: string | undefined): Promise<CurrentUser> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) throw new AppError(401, 'unauthenticated', 'Faça login para continuar.');
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  const session = rows[0];
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new AppError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.');
  }
  const usersFound = await db.select().from(users).where(eq(users.id, session.userId));
  const user = usersFound[0];
  if (!user) throw new AppError(401, 'unauthenticated', 'Sua sessão expirou. Entre novamente.');
  return toCurrentUser(user);
}

export async function requestPasswordReset(db: Database, input: unknown, origin: string): Promise<{ devResetUrl?: string }> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'validation', zodError(parsed.error));
  const rows = await db.select().from(users).where(eq(users.email, parsed.data.email));
  const user = rows[0];
  if (!emailConfigured()) {
    const response: { devResetUrl?: string } = {};
    if (user && process.env.NODE_ENV !== 'production') {
      const token = createToken();
      await db.insert(passwordResets).values({
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        usedAt: null,
        createdAt: new Date().toISOString(),
      });
      response.devResetUrl = `${origin.replace(/\/$/, '')}/reset-password?token=${token}`;
    }
    throw new AppError(
      503,
      'email_not_configured',
      'O serviço de e-mail não está configurado. Nenhum e-mail foi enviado.',
      response.devResetUrl ? { devResetUrl: response.devResetUrl } : undefined,
    );
  }
  if (!user) return {};
  const token = createToken();
  await db.insert(passwordResets).values({
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    usedAt: null,
    createdAt: new Date().toISOString(),
  });
  const link = `${origin.replace(/\/$/, '')}/reset-password?token=${token}`;
  await sendPasswordReset(user.email, link);
  return {};
}

export async function resetPassword(db: Database, input: unknown): Promise<void> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'validation', zodError(parsed.error));
  const rows = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, hashToken(parsed.data.token)));
  const reset = rows[0];
  if (!reset || reset.usedAt || new Date(reset.expiresAt).getTime() <= Date.now()) {
    throw new AppError(400, 'invalid_token', 'O link de recuperação é inválido ou expirou.');
  }
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date().toISOString() }).where(eq(users.id, reset.userId));
  await db.update(passwordResets).set({ usedAt: new Date().toISOString() }).where(eq(passwordResets.id, reset.id));
  await db.update(sessions).set({ revokedAt: new Date().toISOString() }).where(and(eq(sessions.userId, reset.userId), isNull(sessions.revokedAt)));
}

export async function updateProfile(db: Database, userId: string, input: unknown): Promise<CurrentUser> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'validation', zodError(parsed.error));
  const rows = await db.select().from(users).where(eq(users.id, userId));
  const current = rows[0];
  if (!current) throw new AppError(401, 'unauthenticated', 'Faça login para continuar.');
  let avatarUrl = current.avatarUrl;
  if (parsed.data.avatarDataUrl) avatarUrl = await storeAvatar(db, userId, parsed.data.avatarDataUrl);
  const now = new Date().toISOString();
  const next = { ...current, displayName: parsed.data.displayName.trim(), profileColor: parsed.data.profileColor, avatarUrl, updatedAt: now };
  await db.update(users).set({ displayName: next.displayName, profileColor: next.profileColor, avatarUrl, updatedAt: now }).where(eq(users.id, userId));
  const ctx: SyncContext = { db, actorId: userId, now, audience: new Set() };
  await addChange(ctx, { entityType: 'profile', entityId: userId, op: 'upsert', record: toProfile(next), version: null, audienceUserIds: [userId] });
  return toCurrentUser(next);
}

export async function changePassword(db: Database, userId: string, cookieHeader: string | undefined, input: unknown): Promise<void> {
  const parsed = passwordChangeSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, 'validation', zodError(parsed.error));
  const rows = await db.select().from(users).where(eq(users.id, userId));
  const user = rows[0];
  if (!user) throw new AppError(401, 'unauthenticated', 'Faça login para continuar.');
  const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) throw new AppError(401, 'invalid_credentials', 'A senha atual está incorreta.');
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password), updatedAt: new Date().toISOString() }).where(eq(users.id, userId));
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  const currentHash = token ? hashToken(token) : null;
  const openSessions = await db.select().from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  for (const session of openSessions) {
    if (session.tokenHash !== currentHash) {
      await db.update(sessions).set({ revokedAt: new Date().toISOString() }).where(eq(sessions.id, session.id));
    }
  }
}
