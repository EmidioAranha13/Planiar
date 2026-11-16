import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import 'temporal-polyfill/global';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/700.css';
import { AppRouter } from './app/router';
import { useRegisterSW } from 'virtual:pwa-register/react';
import './index.css';

const queryClient = new QueryClient();

if (localStorage.getItem('planiar.theme') === 'dark') {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <ServiceWorkerPrompt />
      <Toaster richColors position="top-center" />
    </QueryClientProvider>
  </StrictMode>,
);

function ServiceWorkerPrompt() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <button className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => void updateServiceWorker(true)}>
      Atualizar aplicativo
    </button>
  );
}
