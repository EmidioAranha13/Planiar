import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi, type ApiRequest } from '../app';

const MAX_BYTES = 4_500_000;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const preset = (req as IncomingMessage & { body?: unknown }).body;
  if (preset && typeof preset === 'object') return preset;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BYTES) {
      throw new Error('payload_too_large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return preset ?? null;
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const forwarded = header(req, 'x-forwarded-for')?.split(',')[0]?.trim();
    const apiReq: ApiRequest = {
      method: req.method ?? 'GET',
      url: req.url ?? '/',
      headers: {
        origin: header(req, 'origin'),
        cookie: header(req, 'cookie'),
        'x-planiar-request': header(req, 'x-planiar-request'),
        'user-agent': header(req, 'user-agent'),
        'content-type': header(req, 'content-type'),
      },
      body: await readBody(req),
      ip: forwarded || req.socket.remoteAddress || 'unknown',
    };
    const response = await handleApi(apiReq);
    res.statusCode = response.status;
    for (const [key, value] of Object.entries(response.headers ?? {})) res.setHeader(key, value);
    if (response.cookies?.length) res.setHeader('set-cookie', response.cookies);
    if (response.raw) {
      res.end(Buffer.from(response.raw));
      return;
    }
    res.end(JSON.stringify(response.body ?? null));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'payload_too_large';
    res.statusCode = tooLarge ? 413 : 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: {
        code: tooLarge ? 'payload_too_large' : 'internal',
        message: tooLarge ? 'O arquivo enviado é grande demais.' : 'Erro interno.',
      },
    }));
  }
}
