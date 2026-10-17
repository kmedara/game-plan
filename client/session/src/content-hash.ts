/**
 * Adds the request body hash Lambda function URLs require behind CloudFront.
 *
 * CloudFront signs each API request for the function URL but does not hash the
 * body, and Lambda rejects unsigned payloads. The client sends the SHA-256 of
 * the exact body bytes in `x-amz-content-sha256` instead. React Native has no
 * Web Crypto digest, so the hash is computed here on every platform.
 */

/** Header CloudFront includes in its signature as the payload hash. */
export const CONTENT_SHA256_HEADER = 'x-amz-content-sha256';

/** SHA-256 round constants. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Rotates a 32-bit word right.
 *
 * @param value - The word.
 * @param bits - Bits to rotate.
 * @returns The rotated word.
 */
const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

/**
 * Hashes bytes with SHA-256.
 *
 * @param bytes - The message.
 * @returns The lowercase hex digest.
 */
export const sha256Hex = (bytes: Uint8Array): string => {
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    // Uint32Array stores each sum modulo 2^32.
    hash[0] = hash[0]! + a;
    hash[1] = hash[1]! + b;
    hash[2] = hash[2]! + c;
    hash[3] = hash[3]! + d;
    hash[4] = hash[4]! + e;
    hash[5] = hash[5]! + f;
    hash[6] = hash[6]! + g;
    hash[7] = hash[7]! + h;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('');
};

/** Methods whose requests carry no body, so CloudFront signs the empty payload. */
const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Wraps `fetch` so writes carry {@link CONTENT_SHA256_HEADER}.
 *
 * Only string and empty bodies are hashed. The API sends JSON strings; other
 * body types pass through unchanged.
 *
 * @param fetchImpl - The underlying fetch.
 * @returns A fetch with the same signature.
 */
export const withContentHash =
  (fetchImpl: typeof fetch): typeof fetch =>
  (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body;
    if (BODYLESS.has(method) || (body !== undefined && body !== null && typeof body !== 'string')) {
      return fetchImpl(input, init);
    }
    const hash = sha256Hex(new TextEncoder().encode(body ?? ''));
    const headers = init?.headers;
    if (headers === undefined || (!Array.isArray(headers) && !(headers instanceof Headers))) {
      return fetchImpl(input, {
        ...init,
        headers: { ...headers, [CONTENT_SHA256_HEADER]: hash },
      });
    }
    const merged = new Headers(headers);
    merged.set(CONTENT_SHA256_HEADER, hash);
    return fetchImpl(input, { ...init, headers: merged });
  };
