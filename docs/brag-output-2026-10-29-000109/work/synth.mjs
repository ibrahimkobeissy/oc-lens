// Soundtrack synth: 120 BPM, C major. node synth.mjs out.wav
import { writeFileSync } from 'node:fs';
const SR = 44100, DUR = 23.2, N = Math.ceil(SR * DUR);
const BEAT = 0.5;
const dry = [new Float32Array(N), new Float32Array(N)];
const send = [new Float32Array(N), new Float32Array(N)];
let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function biquad(type, f, q = 0.707) {
  const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = a; b1 = 0; b2 = -a; }
  a0 = 1 + a; a1 = -2 * c; a2 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
function add(t0, len, fn, gain, pan = 0, sendAmt = 0) {
  const i0 = Math.round(t0 * SR), n = Math.round(len * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n; i++) {
    const k = i0 + i; if (k < 0 || k >= N) continue;
    const v = fn(i / SR, i);
    dry[0][k] += v * gl; dry[1][k] += v * gr;
    if (sendAmt) { send[0][k] += v * gl * sendAmt; send[1][k] += v * gr * sendAmt; }
  }
}

// ---------- instruments ----------
function kick(t, g = 1) {
  let ph = 0;
  add(t, 0.45, (x) => { const f = 48 + 110 * Math.exp(-x * 28); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * Math.exp(-x * 7.5) + (x < .004 ? rnd() * .3 * (1 - x / .004) : 0); }, 0.9 * g);
}
function boom(t) {
  let ph = 0;
  add(t, 1.2, (x) => { const f = 40 + 90 * Math.exp(-x * 14); ph += 2 * Math.PI * f / SR; return Math.tanh(1.6 * Math.sin(ph)) * Math.exp(-x * 3.2); }, 0.75, 0, 0.15);
}
function clap(t, g = 1) {
  const bp = biquad('bp', 1400, 1.2);
  add(t, 0.3, (x) => { const env = (x < .01 ? 1 : x < .02 ? .7 : 1) * Math.exp(-x * 18); return bp(rnd()) * env * 3; }, 0.22 * g, 0.05, 0.55);
}
function hat(t, g = 1, pan = 0.25) {
  const hp = biquad('hp', 8500, .8);
  add(t, 0.06, (x) => hp(rnd()) * Math.exp(-x * 70), 0.07 * g, pan);
}
function bass(t, m, len) {
  const lp = biquad('lp', 520, 1.1), f = mtof(m);
  add(t, len, (x) => { const p = x * f; let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * p * h) / h; const env = Math.min(1, x / .006) * Math.min(1, (len - x) / .02) * (0.75 + 0.25 * Math.exp(-x * 9)); return lp(v) * env; }, 0.26);
}
function pad(t, notes, len, g = 1) {
  notes.forEach((m, ni) => {
    const lp = biquad('lp', 2200, .7);
    const fs = [-.11, -.04, 0, .05, .12].map(d => mtof(m + d));
    const ph = fs.map(() => (rnd() + 1) / 2);
    add(t, len + .6, (x) => {
      let v = 0; for (let j = 0; j < fs.length; j++) { const pp = (ph[j] + x * fs[j]) % 1; v += 2 * pp - 1; }
      const env = Math.min(1, x / .35) * (x > len ? Math.exp(-(x - len) * 6) : 1);
      return lp(v / fs.length) * env;
    }, 0.07 * g, (ni % 2 ? .35 : -.35), 0.6);
  });
}
function pluck(t, m, g = 1, pan = 0) {
  const f = mtof(m), lp = biquad('lp', 3800, .9);
  add(t, 0.9, (x) => { const e = Math.exp(-x * 6.5); const v = Math.sin(2 * Math.PI * f * x + 1.3 * e * Math.sin(2 * Math.PI * f * 2 * x)); return lp(v) * e * Math.min(1, x / .003); }, 0.16 * g, pan, 0.5);
}
function whoosh(tc, len = .45, g = 1) {
  const bpv = mkbpv();
  // swell into the cut, quick release after
  add(tc - len, len + .25, (x) => {
    const u = x / len; const f = 300 + 4200 * Math.min(1, u) ** 2;
    const env = u < 1 ? u ** 2.2 : Math.exp(-(x - len) * 22);
    return bpv(rnd(), f) * env;
  }, 0.28 * g, 0, 0.5);
}
// Time-varying bandpass (state per call)
function mkbpv() { const bpS = { x1: 0, x2: 0, y1: 0, y2: 0 }; return (x, f, q = 1.6) => {
  const w = 2 * Math.PI * f / SR, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  const y = (a * x - a * bpS.x2 + 2 * c * bpS.y1 - (1 - a) * bpS.y2) / (1 + a);
  bpS.x2 = bpS.x1; bpS.x1 = x; bpS.y2 = bpS.y1; bpS.y1 = y; return y; }; }
function riser(t0, t1, g = 1) {
  const len = t1 - t0, bpv = mkbpv();
  add(t0, len, (x) => { const u = x / len; return bpv(rnd(), 500 + 5000 * u * u, 2.2) * u ** 2 * 1.2; }, 0.22 * g, 0, 0.6);
}
function crash(t) {
  const hp = biquad('hp', 5200, .7);
  add(t, 2.2, (x) => hp(rnd()) * Math.exp(-x * 2.2), 0.09, 0, 0.5);
}
function tick(t) {
  const hp = biquad('hp', 3000, .7);
  add(t, 0.02, (x) => hp(rnd()) * Math.exp(-x * 300), 0.05, 0.3);
}

// ---------- arrangement ----------
// Chord per bar (2 s): C G Am F C G Am F C G | C (hold)
const chords = { C: [48, [60, 64, 67, 71]], G: [43, [59, 62, 67, 69]], Am: [45, [60, 64, 69, 71]], F: [41, [60, 65, 69, 72]] };
const bars = ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'C', 'C'];
const chordAt = t => chords[bars[Math.min(bars.length - 1, Math.floor(t / 2))]];
const kicks = [];

// Hook: kick + rising pluck on each card, boom on the 4× stamp
pad(0, chords.C[1], 2, .55); pad(2, chords.G[1], 1.5, .55);
[0.5, 1.0, 1.5, 2.0].forEach((t, i) => { kick(t, .9); kicks.push(t); pluck(t, [72, 76, 79, 84][i], 1.1, [-.3, .1, -.1, .3][i]); });
boom(2.5); kick(2.5, 1.1); kicks.push(2.5); clap(2.5, 1.3); pluck(2.5, 60, .9);
riser(2.7, 3.5);
whoosh(3.5, .5, 1.2);

// Drop at 4.0 through 19.0
crash(4.0); boom(4.0);
for (let t = 3.5; t < 19.0 - 1e-6; t += BEAT) {
  const inGroove = t >= 4.0;
  if (inGroove) { kick(t); kicks.push(t); }
  const b = Math.round(t / BEAT) % 4;
  if (inGroove && (b === 1 || b === 3)) clap(t);
  if (inGroove) { hat(t + .25, 1); if (t >= 6.5) hat(t + .125, .45, -.25), hat(t + .375, .45, -.25); }
  if (inGroove) { const [root] = chordAt(t); bass(t, root, .22); bass(t + .25, root + 12, .2); }
}
for (let bar = 2; bar < 9; bar++) pad(bar * 2, chordAt(bar * 2)[1], 2, 1);
pad(18, chords.G[1], 1.0, .8);
// Arp, 8ths, from the drop
for (let t = 4.0, i = 0; t < 21.0 - 1e-6; t += .25, i++) {
  const tones = chordAt(t)[1]; const seq = [0, 1, 2, 3, 2, 1, 3, 2];
  pluck(t, tones[seq[i % 8]] + 12, t >= 19 ? .45 : .38, i % 2 ? .4 : -.4);
}
// Scene cuts and pops
[6.5, 10, 13.5, 16.5].forEach(t => whoosh(t, .38, .75));
[[8.1, 79], [11.6, 76], [14.45, 74], [14.95, 79], [17.0, 72], [17.5, 76], [18.0, 79]].forEach(([t, m]) => pluck(t, m + 12, .55, .2));
riser(18.3, 19.0, .8);
whoosh(19.0, .5, 1.1);
// Outro: groove drops out, then resolves on C
crash(19.0); kick(19.0); kicks.push(19.0);
pad(19, chords.G[1], 1.0, .9);
for (let k = 0; k < 11; k++) tick(19.55 + k * .055);
pad(20, chords.C[1], 2.4, 1.1);
add(20, 2.5, (x) => Math.sin(2 * Math.PI * 65.41 * x) * Math.exp(-x * 1.6) * Math.min(1, x / .01), 0.3); kick(20, .8); kicks.push(20);
[60, 64, 67, 72, 76].forEach((m, i) => pluck(20 + i * .06, m + 12, .5, (i - 2) * .2));

// ---------- sidechain on everything but drums is approximated by ducking pad/bass sends via global env ----------
const duck = new Float32Array(N).fill(1);
kicks.forEach(tk => { const i0 = Math.round(tk * SR); for (let i = 0; i < SR * .3; i++) { const k = i0 + i; if (k < N) duck[k] = Math.min(duck[k], 1 - .45 * Math.exp(-i / SR / .09)); } });

// ---------- reverb (Schroeder) on send ----------
function reverb(inp) {
  const out = new Float32Array(N);
  const combs = [1557, 1617, 1491, 1422].map(d => ({ b: new Float32Array(d), i: 0, f: .8 }));
  const aps = [225, 556].map(d => ({ b: new Float32Array(d), i: 0 }));
  let lp = 0;
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (const c of combs) { const y = c.b[c.i]; lp = y; c.b[c.i] = inp[k] + y * c.f; c.i = (c.i + 1) % c.b.length; s += y; }
    s *= .25;
    for (const a of aps) { const y = a.b[a.i]; const v = -s + y; a.b[a.i] = s + y * .5; a.i = (a.i + 1) % a.b.length; s = v; }
    out[k] = s;
  }
  return out;
}
const rv = [reverb(send[0]), reverb(send[1])];
// Stereo delay (dotted 8th) on sends too, subtle
const D = Math.round(.375 * SR);
for (let ch = 0; ch < 2; ch++) for (let k = D; k < N; k++) rv[ch][k] += send[1 - ch][k - D] * .22;

const L = new Float32Array(N), R = new Float32Array(N);
for (let k = 0; k < N; k++) {
  const d = duck[k];
  L[k] = Math.tanh((dry[0][k] * (0.55 + 0.45 * d) + rv[0][k] * 0.35 * d) * 1.1);
  R[k] = Math.tanh((dry[1][k] * (0.55 + 0.45 * d) + rv[1][k] * 0.35 * d) * 1.1);
}
// Final fade 22.0–22.5
for (let k = 0; k < N; k++) { const t = k / SR; if (t > 22.0) { const g = Math.max(0, 1 - (t - 22.0) / .5); L[k] *= g; R[k] *= g; } }
let peak = 0; for (let k = 0; k < N; k++) peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k]));
const norm = .89 / peak;
const NN = Math.round(22.5 * SR);
const buf = Buffer.alloc(44 + NN * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + NN * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(NN * 4, 40);
for (let k = 0; k < NN; k++) { buf.writeInt16LE(Math.round(L[k] * norm * 32767), 44 + k * 4); buf.writeInt16LE(Math.round(R[k] * norm * 32767), 46 + k * 4); }
writeFileSync(process.argv[2] || 'music.wav', buf);
console.log('peak', peak.toFixed(3));
