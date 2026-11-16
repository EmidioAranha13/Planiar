import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleNodeRequest } from '../server/http/node';

export const runtime = 'nodejs';

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleNodeRequest(req, res);
}
