import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuffer = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

function createPng(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = paint(x, y, size)
      const offset = row + 1 + x * 4
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function paint(x, y, size) {
  const teal = [15, 118, 110, 255]
  const cardLeft = size * 0.22
  const cardRight = size * 0.78
  const cardTop = size * 0.22
  const cardBottom = size * 0.8
  const headerBottom = cardTop + size * 0.14
  if (x < cardLeft || x > cardRight || y < cardTop || y > cardBottom) return teal
  if (y < headerBottom) return [17, 94, 89, 255]
  const columns = [0.34, 0.5, 0.66]
  const rows = [0.48, 0.64]
  for (const column of columns) {
    for (const row of rows) {
      const cx = size * column
      const cy = size * row
      if (Math.abs(x - cx) < size * 0.035 && Math.abs(y - cy) < size * 0.035) return [15, 118, 110, 255]
    }
  }
  if ((x - size * 0.68) ** 2 + (y - size * 0.7) ** 2 < (size * 0.045) ** 2) return [245, 158, 11, 255]
  return [255, 255, 255, 255]
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', createPng(192, paint))
writeFileSync('public/icons/icon-512.png', createPng(512, paint))
writeFileSync('public/icons/icon-maskable-512.png', createPng(512, paint))
writeFileSync('public/icons/apple-touch-icon.png', createPng(180, paint))
