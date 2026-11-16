export const SESSION_COOKIE = 'planiar_session';

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.APP_ORIGIN?.startsWith('https://') || process.env.VERCEL_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  const secure = process.env.APP_ORIGIN?.startsWith('https://') || process.env.VERCEL_ENV === 'production';
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return rest.join('=');
  }
  return null;
}
