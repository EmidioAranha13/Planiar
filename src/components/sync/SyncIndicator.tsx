import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react';
import { useSyncStore } from '../../stores/syncStore';

const labels = {
  idle: 'Aguardando',
  synced: 'Sincronizado',
  syncing: 'Sincronizando',
  offline: 'Offline',
  pending: 'Alterações pendentes',
  error: 'Erro de sincronização',
  conflict: 'Conflito detectado',
};

export function SyncIndicator() {
  const status = useSyncStore((state) => state.status);
  const pending = useSyncStore((state) => state.pending);
  const lastError = useSyncStore((state) => state.lastError);
  const realtime = useSyncStore((state) => state.realtime);
  const Icon = status === 'offline' ? CloudOff : status === 'conflict' || status === 'error' ? AlertTriangle : status === 'syncing' ? RefreshCw : Check;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" title={lastError ?? labels[status]}>
      <Icon className={status === 'syncing' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      <span>{labels[status]}{pending > 0 && status !== 'syncing' ? ` (${pending})` : ''}</span>
      <span className="hidden sm:inline">· {realtime === 'connected' ? 'tempo real' : realtime === 'ably' ? 'Ably configurado' : 'atualização periódica'}</span>
    </div>
  );
}
