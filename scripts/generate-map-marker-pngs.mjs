/**
 * Writes assets/markers/*.png (RGBA) — run: node scripts/generate-map-marker-pngs.mjs
 * No dependencies; PNG filter type 0 per scanline.
 */
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, '..', 'assets', 'markers')

const TEAL = { r: 0, g: 191, b: 165, a: 255 }
const DARK = { r: 20, g: 20, b: 20, a: 255 }
const OUTLINE = { r: 10, g: 10, b: 10, a: 255 }
const WHITE = { r: 255, g: 255, b: 255, a: 255 }

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(typeStr, data) {
  const type = Buffer.from(typeStr, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = crc32(Buffer.concat([type, data]))
  const crcB = Buffer.alloc(4)
  crcB.writeUInt32BE(crc, 0)
  return Buffer.concat([len, type, data, crcB])
}

function writePng(filePath, width, height, pixel) {
  const stride = 1 + width * 4
  const raw = Buffer.alloc(stride * height)
  let o = 0
  for (let y = 0; y < height; y++) {
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      const { r, g, b, a } = pixel(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, png)
}

function inCircle(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2
}

function inRing(x, y, cx, cy, rOuter, rInner) {
  const d2 = (x - cx) ** 2 + (y - cy) ** 2
  return d2 <= rOuter ** 2 && d2 >= rInner ** 2
}

/** Stadium / pill: semicircles at x=r and x=w-r, full height h. */
function inPill(x, y, w, h) {
  const r = Math.floor(h / 2)
  if (x < r) {
    const cx = r
    const cy = (h - 1) / 2
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  if (x >= w - r) {
    const cx = w - 1 - r
    const cy = (h - 1) / 2
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  return y >= 0 && y < h && x >= 0 && x < w
}

// 72×72: teal disc + dark ring (nudge)
const W = 72
writePng(path.join(outDir, 'nudge-pin.png'), W, W, (x, y) => {
  const cx = (W - 1) / 2
  const cy = (W - 1) / 2
  if (inRing(x, y, cx, cy, 22, 18)) return OUTLINE
  if (inCircle(x, y, cx, cy, 18)) return TEAL
  return { r: 0, g: 0, b: 0, a: 0 }
})

// 72×72: dark disc + teal ring (POI)
writePng(path.join(outDir, 'poi-pin.png'), W, W, (x, y) => {
  const cx = (W - 1) / 2
  const cy = (W - 1) / 2
  if (inRing(x, y, cx, cy, 14, 11)) return { r: 0, g: 191, b: 165, a: 255 }
  if (inCircle(x, y, cx, cy, 11)) return DARK
  return { r: 0, g: 0, b: 0, a: 0 }
})

// 128×56: pill with three dots (cluster — no dynamic count in bitmap)
const CW = 128
const CH = 56
writePng(path.join(outDir, 'cluster-pill.png'), CW, CH, (x, y) => {
  if (!inPill(x, y, CW, CH)) return { r: 0, g: 0, b: 0, a: 0 }
  const inner =
    x >= 2 &&
    x < CW - 2 &&
    y >= 2 &&
    y < CH - 2 &&
    inPill(x - 2, y - 2, CW - 4, CH - 4)
  if (!inner) return { r: 255, g: 255, b: 255, a: 255 }
  const dots = [44, 64, 84]
  for (const dx of dots) {
    if (inCircle(x, y, dx, CH / 2, 4)) return WHITE
  }
  return TEAL
})

console.log('Wrote', outDir)
