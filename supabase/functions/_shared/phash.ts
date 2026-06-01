// Perceptual hash (pHash 64-bit) + tile-cropping utilities, shared between
// casino-catalog-scraper (computes hashes for catalog thumbnails) and
// intelligent-vod-agent (computes hashes for storyboard tiles to short-circuit
// the Gemini call when there is a deterministic match in the library).

import { Image } from "https://esm.sh/imagescript@1.2.17";

type DecodedImage = InstanceType<typeof Image>;

function rgbaToGray32(img: DecodedImage): Float64Array {
  // ImageScript is 1-indexed and stores pixels as 0xRRGGBBAA packed in a 32-bit
  // integer. We resize to 32x32 once and read pixel-by-pixel.
  const resized = img.resize(32, 32);
  const gray = new Float64Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const pixel = resized.getPixelAt(x + 1, y + 1);
      const r = (pixel >> 24) & 0xff;
      const g = (pixel >> 16) & 0xff;
      const b = (pixel >> 8) & 0xff;
      gray[y * 32 + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return gray;
}

export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage | null> {
  try {
    return await Image.decode(bytes);
  } catch (e) {
    console.error("decodeImage failed:", e);
    return null;
  }
}

function dct1d(input: Float64Array, N: number): Float64Array {
  const out = new Float64Array(N);
  const factor = Math.PI / N;
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let n = 0; n < N; n++) sum += input[n] * Math.cos((n + 0.5) * k * factor);
    out[k] = sum;
  }
  return out;
}

function dct2d(matrix: Float64Array, N: number): Float64Array {
  const tmp = new Float64Array(N * N);
  const row = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) row[x] = matrix[y * N + x];
    const r = dct1d(row, N);
    for (let x = 0; x < N; x++) tmp[y * N + x] = r[x];
  }
  const out = new Float64Array(N * N);
  const col = new Float64Array(N);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) col[y] = tmp[y * N + x];
    const c = dct1d(col, N);
    for (let y = 0; y < N; y++) out[y * N + x] = c[y];
  }
  return out;
}

// Computes the standard 64-bit pHash and returns 8 bytes. The DC coefficient
// (top-left of the DCT block) dominates the magnitude and would otherwise force
// the median past most AC coefficients, making bit[0] almost constant across
// images. We drop it from the median calculation AND from the output, keeping
// the 63 AC coefficients plus one leading bit reserved as zero — still 64 bits,
// but the discriminative ones.
export async function computePHashFromBytes(
  bytes: Uint8Array,
): Promise<Uint8Array | null> {
  const img = await decodeImage(bytes);
  if (!img) return null;
  return computePHashFromDecoded(img);
}

export function computePHashFromDecoded(img: DecodedImage): Uint8Array | null {
  try {
    const gray = rgbaToGray32(img);
    const dct = dct2d(gray, 32);
    // Take top-left 8x8 block (low-frequency).
    const coefs: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        coefs.push(dct[y * 32 + x]);
      }
    }
    // Median over AC coefficients only (skip index 0 — the DC).
    const ac = coefs.slice(1);
    const sorted = [...ac].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const out = new Uint8Array(8);
    // bit[0] is always 0 (reserved — DC dropped). bits[1..63] = AC > median.
    for (let i = 0; i < 63; i++) {
      if (ac[i] > median) out[(i + 1) >> 3] |= 1 << (7 - ((i + 1) & 7));
    }
    return out;
  } catch (e) {
    console.error("computePHashFromDecoded failed:", e);
    return null;
  }
}

// Crops a single tile from a mosaic image (already decoded) and computes its
// pHash. Used by the VOD agent to hash storyboard tiles in-place.
export function computeTilePHash(
  mosaic: DecodedImage,
  col: number,
  row: number,
  tileW: number,
  tileH: number,
): Uint8Array | null {
  try {
    const sub = mosaic.clone().crop(col * tileW, row * tileH, tileW, tileH);
    return computePHashFromDecoded(sub);
  } catch (e) {
    console.error("computeTilePHash failed:", e);
    return null;
  }
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// supabase-js / PostgREST round-trips bytea as the textual `\x...` form.
export function bytesToPgHex(b: Uint8Array): string {
  return "\\x" + bytesToHex(b);
}
