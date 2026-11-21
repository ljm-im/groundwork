const increment = 0x6D2B79F5;

function sampleRandom(a) {
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

export function randomAt(seed, index) {
  return sampleRandom((seed + Math.imul(index + 1, increment)) | 0);
}

export function random(seed) {
  let a = seed | 0;
  return () => sampleRandom(a = (a + increment) | 0);
}

const gx = [1, -1, 1, -1, 1, -1, 0, 0],
  gy = [1, 1, -1, -1, 0, 0, 1, -1];
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

export function noise(seed) {
  const next = random(seed),
    p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  p.copyWithin(256, 0, 256);
  return (x, y) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      X = ix & 255,
      Y = iy & 255;
    x -= ix;
    y -= iy;
    const u = fade(x),
      v = fade(y);
    const a = p[X + p[Y]] & 7,
      b = p[X + 1 + p[Y]] & 7;
    const c = p[X + p[Y + 1]] & 7,
      d = p[X + 1 + p[Y + 1]] & 7;
    const h0 = gx[a] * x + gy[a] * y,
      h1 = gx[b] * (x - 1) + gy[b] * y;
    const h2 = gx[c] * x + gy[c] * (y - 1),
      h3 = gx[d] * (x - 1) + gy[d] * (y - 1);
    const bottom = h0 + (h1 - h0) * u;
    return (bottom + (h2 + (h3 - h2) * u - bottom) * v) * 1.4;
  };
}

export function fbm(n, x, y, count, ridged = false) {
  let sum = 0,
    weight = 0,
    a = 1,
    f = 1;
  for (let i = 0; i < count; i++) {
    const v = ridged ? 1 - Math.abs(n(x * f + i * 5.7, y * f + i * 3.3)) : n(x * f + i * 17.3, y * f - i * 9.1);
    sum += a * (ridged ? v * v : v);
    weight += a;
    a *= .5;
    f *= ridged ? 2.1 : 2.03;
  }
  return sum / weight;
}