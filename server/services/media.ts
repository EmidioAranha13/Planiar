import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { parseImageDataUrl } from '../../src/domain/rules/image';
import type { Database } from '../database/client';
import { mediaObjects, routineMembers } from '../database/schema';
import { AppError } from '../http/errors';
import { decryptBytes, encryptBytes, encryptionAvailable } from '../security/crypto';

export function storageMode(): 'blob' | 'postgres' {
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'postgres';
}

export async function storeAvatar(db: Database, ownerId: string, dataUrl: string): Promise<string> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed.ok) throw new AppError(400, 'invalid_image', parsed.message);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`avatars/${ownerId}/${crypto.randomUUID()}`, Buffer.from(parsed.image.bytes), {
      access: 'public',
      contentType: parsed.image.mime,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return blob.url;
  }
  if (!encryptionAvailable()) {
    throw new AppError(503, 'encryption_not_configured', 'Defina APP_ENCRYPTION_KEY para armazenar imagens.');
  }
  const id = crypto.randomUUID();
  await db.insert(mediaObjects).values({
    id,
    ownerId,
    mimeType: parsed.image.mime,
    byteSize: parsed.image.bytes.byteLength,
    ciphertext: encryptBytes(parsed.image.bytes),
    createdAt: new Date().toISOString(),
  });
  return `/api/media/${id}`;
}

export async function readAvatar(
  db: Database,
  mediaId: string,
  requesterId: string,
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  const rows = await db.select().from(mediaObjects).where(eq(mediaObjects.id, mediaId));
  const media = rows[0];
  if (!media) return null;
  if (media.ownerId !== requesterId) {
    const mine = alias(routineMembers, 'mine');
    const theirs = alias(routineMembers, 'theirs');
    const shared = await db
      .select({ id: mine.id })
      .from(mine)
      .innerJoin(theirs, eq(mine.routineId, theirs.routineId))
      .where(and(eq(mine.userId, requesterId), eq(theirs.userId, media.ownerId)))
      .limit(1);
    if (!shared[0]) throw new AppError(403, 'forbidden', 'Você não pode acessar esta imagem.');
  }
  return { mimeType: media.mimeType, bytes: decryptBytes(media.ciphertext) };
}
