const MAX_BYTES = 2 * 1024 * 1024;

export type ParsedImage = {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: Uint8Array;
};

export function parseImageDataUrl(dataUrl: string): { ok: true; image: ParsedImage } | { ok: false; message: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match?.[1] || !match[2]) {
    return { ok: false, message: 'Envie uma imagem PNG, JPEG ou WebP.' };
  }
  const mime = match[1] as ParsedImage['mime'];
  const binary = atob(match[2].replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length > MAX_BYTES) return { ok: false, message: 'A imagem deve ter no máximo 2 MB.' };
  if (bytes.length < 12) return { ok: false, message: 'O arquivo de imagem está incompleto.' };
  if (mime === 'image/png' && !hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: false, message: 'O arquivo não é um PNG válido.' };
  }
  if (mime === 'image/jpeg' && !hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: false, message: 'O arquivo não é um JPEG válido.' };
  }
  if (mime === 'image/webp' && (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP')) {
    return { ok: false, message: 'O arquivo não é um WebP válido.' };
  }
  return { ok: true, image: { mime, bytes } };
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
