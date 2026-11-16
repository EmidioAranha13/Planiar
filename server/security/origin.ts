import { AppError } from '../http/errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function allowedOrigins(): string[] {
  const origins = new Set<string>();
  if (process.env.APP_ORIGIN) origins.add(process.env.APP_ORIGIN);
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    origins.add('http://localhost:5174');
    origins.add('http://127.0.0.1:5174');
    origins.add('http://localhost:4173');
    origins.add('http://127.0.0.1:4173');
  }
  return [...origins];
}

export function assertTrustedRequest(method: string, headers: Record<string, string | undefined>): void {
  if (SAFE.has(method.toUpperCase())) return;
  if (headers['x-planiar-request'] !== '1') {
    throw new AppError(403, 'csrf', 'A requisição foi recusada.');
  }
  const origin = headers.origin;
  const allowed = allowedOrigins();
  if (!origin || !allowed.includes(origin)) {
    throw new AppError(403, 'csrf', 'A origem da requisição foi recusada.');
  }
}
