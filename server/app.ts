import type { HealthStatus } from '../src/domain/entities/types';
import { pullRequestSchema, pushRequestSchema } from '../src/domain/schemas/records';
import { encryptionAvailable } from './security/crypto';
import { allowedOrigins, assertTrustedRequest } from './security/origin';
import { getDatabase, getDatabaseMode } from './database/client';
import { AppError } from './http/errors';
import {
  changePassword,
  currentUser,
  loginUser,
  logoutUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  updateProfile,
} from './services/authService';
import { readAvatar, storageMode } from './services/media';
import { executeOperation, pullChanges, retentionReport } from './services/operations';
import { createRealtimeToken, realtimeConfigured } from './services/realtime';
import { emailConfigured } from './services/email';

export type ApiRequest = {
  method: string;
  url: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  ip: string;
};

export type ApiResponse = {
  status: number;
  body?: unknown;
  raw?: Uint8Array;
  headers?: Record<string, string>;
  cookies?: string[];
};

function json(status: number, body: unknown, cookies?: string[]): ApiResponse {
  return {
    status,
    body,
    cookies,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  };
}

function pathname(url: string): string {
  const path = url.split('?')[0] ?? url;
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function requestOrigin(req: ApiRequest): string {
  return req.headers.origin ?? process.env.APP_ORIGIN ?? allowedOrigins()[0] ?? 'http://localhost:5174';
}

export async function handleApi(req: ApiRequest): Promise<ApiResponse> {
  try {
    assertTrustedRequest(req.method, req.headers);
    const path = pathname(req.url);
    const method = req.method.toUpperCase();
    if (method === 'GET' && path === '/api/health') return json(200, await healthBody());
    const db = await getDatabase();
    const meta = { ip: req.ip, userAgent: req.headers['user-agent'] ?? null };

    if (method === 'POST' && path === '/api/auth/register') {
      const result = await registerUser(db, req.body, meta);
      return json(201, { user: result.user, routine: result.routine, member: result.member }, [result.cookie]);
    }
    if (method === 'POST' && path === '/api/auth/login') {
      const result = await loginUser(db, req.body, meta);
      return json(200, { user: result.user }, [result.cookie]);
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      const cookie = await logoutUser(db, req.headers.cookie);
      return json(200, { ok: true }, [cookie]);
    }
    if (method === 'POST' && path === '/api/auth/forgot-password') {
      const result = await requestPasswordReset(db, req.body, requestOrigin(req));
      return json(200, { ok: true, ...result });
    }
    if (method === 'POST' && path === '/api/auth/reset-password') {
      await resetPassword(db, req.body);
      return json(200, { ok: true });
    }
    if (method === 'GET' && path === '/api/auth/me') {
      return json(200, { user: await currentUser(db, req.headers.cookie) });
    }

    const user = await currentUser(db, req.headers.cookie);
    if (method === 'PATCH' && path === '/api/auth/profile') {
      return json(200, { user: await updateProfile(db, user.id, req.body) });
    }
    if (method === 'POST' && path === '/api/auth/password') {
      await changePassword(db, user.id, req.headers.cookie, req.body);
      return json(200, { ok: true });
    }
    if (method === 'POST' && path === '/api/sync/push') {
      const parsed = pushRequestSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(400, 'validation', 'O lote de sincronização é inválido.');
      const results = [];
      for (const operation of parsed.data.operations) {
        results.push({ id: operation.id, ...(await executeOperation(db, user.id, operation)) });
      }
      return json(200, { results });
    }
    if (method === 'POST' && path === '/api/sync/pull') {
      const parsed = pullRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError(400, 'validation', 'O cursor de sincronização é inválido.');
      return json(200, await pullChanges(db, user.id, parsed.data.cursor));
    }
    if (method === 'GET' && path === '/api/realtime/config') {
      return json(200, { mode: realtimeConfigured() ? 'ably' : 'polling' });
    }
    if (method === 'GET' && path === '/api/realtime/token') {
      return json(200, await createRealtimeToken(user.id));
    }
    if (method === 'GET' && path === '/api/retention/status') {
      return json(200, await retentionReport(db, user.id));
    }
    const mediaMatch = /^\/api\/media\/([0-9a-f-]{36})$/i.exec(path);
    if (method === 'GET' && mediaMatch?.[1]) {
      const media = await readAvatar(db, mediaMatch[1], user.id);
      if (!media) return json(404, { error: { code: 'not_found', message: 'Imagem não encontrada.' } });
      return {
        status: 200,
        raw: media.bytes,
        headers: { 'content-type': media.mimeType, 'cache-control': 'private, max-age=3600' },
      };
    }
    return json(404, { error: { code: 'not_found', message: 'Recurso não encontrado.' } });
  } catch (error) {
    if (error instanceof AppError) {
      return json(error.status, {
        error: { code: error.code, message: error.message },
        ...error.details,
      });
    }
    console.error(error instanceof Error ? error.message : 'request failed');
    return json(500, { error: { code: 'internal', message: 'Erro interno.' } });
  }
}

async function healthBody(): Promise<HealthStatus> {
  let database = getDatabaseMode();
  if (database === 'unconfigured' && process.env.DATABASE_URL) {
    try {
      await getDatabase();
      database = getDatabaseMode();
    } catch {
      database = 'unconfigured';
    }
  }
  return {
    ok: database !== 'unconfigured',
    database,
    emailConfigured: emailConfigured(),
    realtimeConfigured: realtimeConfigured(),
    storage: storageMode(),
    mediaEncryption: encryptionAvailable(),
    retentionDeletion: 'disabled',
    app: 'Planiar',
  };
}
