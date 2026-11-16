export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Planiar-Request': '1',
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Sem conexão com o servidor.');
  }
  const text = await response.text();
  const data = text ? (JSON.parse(text) as { error?: { code?: string; message?: string }; devResetUrl?: string }) : {};
  if (!response.ok) {
    throw new ApiError(response.status, data.error?.code ?? 'request_failed', data.error?.message ?? 'Não foi possível concluir a operação.', data as Record<string, unknown>);
  }
  return data as T;
}
