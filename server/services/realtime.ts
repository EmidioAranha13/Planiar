import { AppError } from '../http/errors';

export function realtimeConfigured(): boolean {
  return Boolean(process.env.ABLY_API_KEY);
}

export async function publishSync(userIds: string[]): Promise<void> {
  const key = process.env.ABLY_API_KEY;
  const unique = [...new Set(userIds)];
  if (!key || unique.length === 0) return;
  const authorization = `Basic ${Buffer.from(key).toString('base64')}`;
  await Promise.all(
    unique.map(async (userId) => {
      try {
        const response = await fetch(`https://rest.ably.io/channels/${encodeURIComponent(`user:${userId}`)}/messages`, {
          method: 'POST',
          headers: { Authorization: authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'sync', data: { at: new Date().toISOString() } }),
        });
        if (!response.ok) console.error('Falha ao publicar atualização em tempo real.');
      } catch {
        console.error('Falha ao publicar atualização em tempo real.');
      }
    }),
  );
}

export async function createRealtimeToken(userId: string): Promise<unknown> {
  if (!process.env.ABLY_API_KEY) {
    throw new AppError(503, 'realtime_unconfigured', 'O serviço de tempo real não está configurado. A sincronização periódica continua ativa.');
  }
  const Ably = (await import('ably')).default;
  const rest = new Ably.Rest({ key: process.env.ABLY_API_KEY });
  return rest.auth.createTokenRequest({
    clientId: userId,
    capability: { [`user:${userId}`]: ['subscribe'] },
  });
}
