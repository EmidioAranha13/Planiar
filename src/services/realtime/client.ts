import { apiRequest } from '../api/client';
import { syncNow } from '../sync/engine';
import { useSyncStore } from '../../stores/syncStore';

export async function startRealtime(userId: string): Promise<() => void> {
  try {
    const config = await apiRequest<{ mode: 'ably' | 'polling' }>('/api/realtime/config');
    if (config.mode !== 'ably') {
      useSyncStore.getState().setRealtime('polling');
      return () => undefined;
    }
    useSyncStore.getState().setRealtime('ably');
    const Ably = (await import('ably')).default;
    const client = new Ably.Realtime({
      authCallback: (_params, callback) => {
        void apiRequest<never>('/api/realtime/token').then(
          (token) => callback(null, token),
          () => callback('Não foi possível autenticar o tempo real.', null),
        );
      },
    });
    const channel = client.channels.get(`user:${userId}`);
    void channel.subscribe(() => {
      void syncNow(userId);
    });
    client.connection.on('connected', () => useSyncStore.getState().setRealtime('connected'));
    return () => {
      channel.unsubscribe();
      client.close();
    };
  } catch {
    useSyncStore.getState().setRealtime('polling');
    return () => undefined;
  }
}
