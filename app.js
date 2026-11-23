/* 내 손글씨 폰트 — 캔버스에 그린 글자로 실제 폰트 파일(OTF) 만들기
   그린 획은 이 기기(localStorage)에만 저장됩니다. */
'use strict';

const CHARS = ('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + '.,!?\'"-():;=').split('');
/* 한글 실험: 자음 14 + 모음 14를 그리면 나머지(쌍자음·겹받침·겹모음)는 조합해서 만듦 */
const CONS = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'.split('');
const VOWS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅛㅜㅠㅡㅣ'.split('');
const JAMO = CONS.concat(VOWS);
const ALL = CHARS.concat(JAMO);
const CANVAS = 600;          // 캔버스 내부 크기(px)
const EM_TOP = 850;          // 캔버스 맨 위 = 폰트 좌표 850
const EM_SPAN = 1100;        // 캔버스 높이 = 1100 폰트 단위
const U = EM_SPAN / CANVAS;  // 1px 당 폰트 단위
const yOf = units => (EM_TOP - units) / U;  // 폰트 단위 → 캔버스 y
const GUIDES = [{ u: 700, name: '대문자 높이' }, { u: 480, name: 'x 높이' }, { u: 0, name: '기준선' }, { u: -200, name: '아래' }];
const SIDE = 50;             // 양옆 여백(폰트 단위)
const SMOOTH_NAMES = ['끔', '약하게', '보통', '강하게'];

let glyphs = store.get('fm-glyphs', {});   // { "A": { w: 펜굵기, strokes: [[[x,y],...], ...] } }  모양 1
let glyphs2 = store.get('fm-glyphs2', {}); // 모양 2(직접 그린 변형)
let fontName = store.get('fm-name', '내손글씨');
let pen = store.get('fm-pen', 18);
let smoothLv = store.get('fm-smooth', 2);  // 곡선 다듬기 0~3
let autoAlt = store.get('fm-autoalt', true);
let useKern = store.get('fm-kern', true);
let mixAlt = store.get('fm-mix', true);
const saveGlyphs = () => { store.set('fm-glyphs', glyphs); store.set('fm-glyphs2', glyphs2); };
const has = (map, c) => !!(map[c] && map[c].strokes.length);
const doneCount = () => CHARS.filter(c => has(glyphs, c)).length;
const jamoCount = () => JAMO.filter(c => has(glyphs, c)).length;

/* ---------- 획 곡선 다듬기 ---------- */
function relax(s) {            // [1,2,1]/4 평균, 끝점 고정
  if (s.length < 3) return s;
  return s.map((p, k) => (k === 0 || k === s.length - 1) ? p : [(s[k - 1][0] + 2 * p[0] + s[k + 1][0]) / 4, (s[k - 1][1] + 2 * p[1] + s[k + 1][1]) / 4]);
}
function chaikin(s) {          // 모서리를 깎아 곡선으로, 끝점 유지
  if (s.length < 3) return s;
  const out = [s[0]];
  for (let k = 0; k < s.length - 1; k++) {
    const [a, b] = [s[k], s[k + 1]];
    out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
  }
  out.push(s[s.length - 1]);
  return out;
}
function simplify(s, tol) {    // Ramer–Douglas–Peucker: 거의 일직선인 점은 빼서 윤곽을 가볍게
  if (s.length < 3) return s;
  const keep = new Uint8Array(s.length); keep[0] = keep[s.length - 1] = 1;
  const stack = [[0, s.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = s[i], [bx, by] = s[j], L = Math.hypot(bx - ax, by - ay);
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) {
      // 끝점이 겹치면(동그라미처럼 닫힌 획) 선까지 거리 대신 점까지 거리
      const d = L < 1 ? Math.hypot(s[k][0] - ax, s[k][1] - ay) : Math.abs((bx - ax) * (ay - s[k][1]) - (ax - s[k][0]) * (by - ay)) / L;
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return s.filter((_, k) => keep[k]);
}
function resample(s, step) {   // 점 간격을 고르게(띄엄띄엄 찍힌 점도 같은 정도로 다듬어지게)
  const out = [s[0]];
  let carry = 0;
  for (let k = 1; k < s.length; k++) {
    const [ax, ay] = s[k - 1], [bx, by] = s[k], L = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= L) { out.push([ax + (bx - ax) * t / L, ay + (by - ay) * t / L]); t += step; }
    carry = L - (t - step);
  }
  const last = s[s.length - 1], end = out[out.length - 1];
  if (Math.hypot(last[0] - end[0], last[1] - end[1]) > .01) out.push(last);
  return out;
}
function smoothStroke(s, lv = smoothLv) {
  if (!lv || s.length < 3) return s;
  let p = resample(s, 3);
  for (let k = 0; k < lv * 2; k++) p = relax(p);
  p = chaikin(p);
  return simplify(p, .6 + lv * .4);
}

/* ---------- 모양 2: 직접 그린 것 또는 자동 변형 ---------- */
function rng(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
function autoVariant(g, ch) {
  // 같은 글자를 손으로 두 번 쓴 것처럼: 살짝 기울이고·늘이고·흔들기(글자마다 같은 결과)
  const r = rng(ch.codePointAt(0) * 7919 + 13);
  const rot = (r() - .5) * .09, sx = .95 + r() * .09, sy = .96 + r() * .07, dy = (r() - .5) * 10;
  const ph = r() * 6.28, amp = 1.5 + r() * 2;
  let n = 0;
  const pts = g.strokes.flat(); const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return { w: g.w * (.93 + r() * .14), strokes: g.strokes.map(s => s.map(([x, y]) => {
    n++;
    const X = (x - cx) * sx, Y = (y - cy) * sy;
    return [cx + X * cos - Y * sin + Math.sin(n * .45 + ph) * amp, cy + X * sin + Y * cos + dy + Math.cos(n * .38 + ph) * amp];
  })) };
}
function altGlyph(ch) {
  if (has(glyphs2, ch)) return glyphs2[ch];
  if (autoAlt && has(glyphs, ch)) return autoVariant(glyphs[ch], ch);
  return null;
}

/* ---------- 한글 자모 조합(실험) ---------- */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'.split('');
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'.split('')];
const SPLIT = { ㄲ: 'ㄱㄱ', ㄸ: 'ㄷㄷ', ㅃ: 'ㅂㅂ', ㅆ: 'ㅅㅅ', ㅉ: 'ㅈㅈ', ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ', ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ' };
const MIXV = { ㅘ: 'ㅗㅏ', ㅙ: 'ㅗㅐ', ㅚ: 'ㅗㅣ', ㅝ: 'ㅜㅓ', ㅞ: 'ㅜㅔ', ㅟ: 'ㅜㅣ', ㅢ: 'ㅡㅣ' };
const HORIZ = 'ㅗㅛㅜㅠㅡ';
// 칸 배치(0~1, x0 y0 x1 y1): 모음 모양(세로 V·가로 H·섞임 M) × 받침 유무
const BOXES = {
  V: { cho: [.04, .1, .58, .9], v: [.56, .02, .98, .98] },
  H: { cho: [.16, .04, .84, .52], h: [.02, .52, .98, .94] },
  M: { cho: [.04, .04, .56, .48], h: [.02, .46, .72, .9], v: [.6, .02, .98, .98] },
  VJ: { cho: [.04, .04, .56, .54], v: [.56, .02, .98, .62], jong: [.16, .62, .84, .98] },
  HJ: { cho: [.18, .02, .82, .36], h: [.02, .36, .98, .62], jong: [.18, .64, .82, .98] },
  MJ: { cho: [.04, .02, .56, .34], h: [.02, .32, .72, .6], v: [.6, .02, .98, .64], jong: [.16, .66, .84, .98] }
};
const HBOX = { x0: 72, y0: yOf(780), x1: 528, y1: yOf(-80) };   // 한글 한 글자가 차지하는 캔버스 영역
function decompose(ch) {
  const c = ch.codePointAt(0) - 0xAC00;
  if (c < 0 || c > 11171) return null;
  return { cho: CHO[Math.floor(c / 588)], jung: JUNG[Math.floor(c % 588 / 28)], jong: JONG[c % 28] };
}
function needJamo(ch) {
  const d = decompose(ch); if (!d) return [];
  const out = [...(SPLIT[d.cho] || d.cho), ...(MIXV[d.jung] || d.jung), ...(d.jong ? (SPLIT[d.jong] || d.jong) : '')];
  return [...new Set(out)];
}
const canCompose = ch => { const n = needJamo(ch); return n.length > 0 && n.every(j => has(glyphs, j)); };
function fitParts(chars, box) {
  // 칸 하나에 자모 1~2개(쌍자음·겹받침은 반씩 나눠서)
  const [x0, y0, x1, y1] = box, W = HBOX.x1 - HBOX.x0, H = HBOX.y1 - HBOX.y0;
  const bx0 = HBOX.x0 + x0 * W, by0 = HBOX.y0 + y0 * H, bw = (x1 - x0) * W, bh = (y1 - y0) * H;
  const list = [...chars];
  return list.map((j, k) => {
    const cw = bw / list.length;
    return fitOne(glyphs[j], bx0 + cw * k, by0, cw, bh);
  });
}
function fitOne(g, bx, by, bw, bh) {
  const st = g.strokes.map(s => smoothStroke(s));
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  st.forEach(s => s.forEach(([x, y]) => { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }));
  const pad = g.w * .35, iw = bw - pad * 2, ih = bh - pad * 2;
  const w = Math.max(c - a, 1), h = Math.max(d - b, 1);
  const s = Math.min(iw / w, ih / h);                       // 비율 유지가 기본, 한쪽은 최대 1.35배까지만 더 늘림
  const sx = Math.min(iw / w, s * 1.35), sy = Math.min(ih / h, s * 1.35);
  const ox = bx + bw / 2 - (a + c) / 2 * sx, oy = by + bh / 2 - (b + d) / 2 * sy;
  return { w: g.w * Math.min(.95, Math.max(.6, Math.sqrt(sx * sy))), strokes: st.map(s => simplify(s.map(([x, y]) => [x * sx + ox, y * sy + oy]), 1.2)), smooth: true };
}
function composeParts(ch) {
  if (!canCompose(ch)) return null;
  const { cho, jung, jong } = decompose(ch);
  const kind = MIXV[jung] ? 'M' : HORIZ.includes(jung) ? 'H' : 'V';
  const B = BOXES[kind + (jong ? 'J' : '')];
  const parts = [...fitParts(SPLIT[cho] || cho, B.cho)];
  if (kind === 'V') parts.push(...fitParts(jung, B.v));
  if (kind === 'H') parts.push(...fitParts(jung, B.h));
  if (kind === 'M') { parts.push(...fitParts(MIXV[jung][0], B.h), ...fitParts(MIXV[jung][1], B.v)); }
  if (jong) parts.push(...fitParts(SPLIT[jong] || jong, B.jong));
  return parts;
}
// 내보낼 때 넣는 기본 한글: 받침 없는 글자 전부(399) + 기본 자음×자주 쓰는 모음×자주 쓰는 받침
function hangulSet(extra = '') {
  const set = new Set();
  for (let i = 0; i < 19; i++) for (let j = 0; j < 21; j++) set.add(String.fromCharCode(0xAC00 + (i * 21 + j) * 28));
  const ci = CONS.map(c => CHO.indexOf(c)), vi = 'ㅏㅓㅗㅜㅡㅣㅐㅔㅑㅕ'.split('').map(v => JUNG.indexOf(v)), ji = 'ㄱㄴㄹㅁㅂㅅㅇ'.split('').map(j => JONG.indexOf(j));
  ci.forEach(i => vi.forEach(j => ji.forEach(k => set.add(String.fromCharCode(0xAC00 + (i * 21 + j) * 28 + k)))));
  [...extra].forEach(ch => decompose(ch) && set.add(ch));
  return [...set].filter(canCompose);
}

/* ---------- 획 → 폰트 윤곽선 ---------- */
function circlePts(x, y, r, n = 10) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return pts;
}
function strokeContours(stroke, w) {
  // 이웃한 점 사이는 사각형, 끝점·크게 꺾인 곳은 원, 살짝 꺾인 곳은 틈만 메우는 사각형.
  // 모두 같은 방향(반시계)으로 감아 겹치는 부분이 합쳐지게 함. 원을 아껴 파일을 가볍게.
  const r = w / 2, out = [], n = stroke.length;
  const nor = k => { const [x1, y1] = stroke[k], [x2, y2] = stroke[k + 1], len = Math.hypot(x2 - x1, y2 - y1); return len < .5 ? null : [-(y2 - y1) / len * r, (x2 - x1) / len * r]; };
  const norms = []; for (let k = 0; k < n - 1; k++) norms.push(nor(k));
  stroke.forEach(([x, y], k) => {
    const a = norms[k - 1], b = norms[k];
    if (k === 0 || k === n - 1 || !a || !b) { out.push(circlePts(x, y, r, 12)); return; }
    const cos = (a[0] * b[0] + a[1] * b[1]) / (r * r);
    if (cos < .85) out.push(circlePts(x, y, r, 12));               // 약 32° 넘게 꺾임
    else if (cos < .9995) out.push([[x + a[0], y + a[1]], [x + b[0], y + b[1]], [x - b[0], y - b[1]], [x - a[0], y - a[1]]]);
  });
  for (let k = 1; k < n; k++) {
    const m = norms[k - 1]; if (!m) continue;
    const [x1, y1] = stroke[k - 1], [x2, y2] = stroke[k];
    out.push([[x1 + m[0], y1 + m[1]], [x2 + m[0], y2 + m[1]], [x2 - m[0], y2 - m[1]], [x1 - m[0], y1 - m[1]]]);
  }
  return out;
}
function toFontPts(poly) {
  // 캔버스(아래로 +y) → 폰트(위로 +y). 뒤집히면 감는 방향도 바뀌므로 면적 부호로 반시계 맞춤.
  const pts = poly.map(([x, y]) => [x * U, EM_TOP - y * U]);
  let area = 0;
  for (let k = 0; k < pts.length; k++) { const [a, b] = pts[k], [c, d] = pts[(k + 1) % pts.length]; area += a * d - c * b; }
  return area < 0 ? pts.reverse() : pts;
}
// 글자 하나 = 획 묶음 여러 개(라틴은 1개, 한글은 자모별). 다듬기는 여기서 한 번만.
const partsOf = g => [{ w: g.w, strokes: g.strokes.map(s => smoothStroke(s)) }];
function partsBounds(parts) {
  let minX = Infinity, maxX = -Infinity;
  parts.forEach(p => p.strokes.forEach(s => s.forEach(([x]) => { minX = Math.min(minX, x - p.w / 2); maxX = Math.max(maxX, x + p.w / 2); })));
  return { minX, maxX };
}
const glyphBounds = g => partsBounds(partsOf(g));
function partsPath(parts, shift) {
  const path = new opentype.Path();
  parts.forEach(p => p.strokes.forEach(s => strokeContours(s, p.w).forEach(poly => {
    toFontPts(poly).forEach(([x, y], k) => (k ? path.lineTo(Math.round(x + shift), Math.round(y)) : path.moveTo(Math.round(x + shift), Math.round(y))));
    path.close();
  })));
  return path;
}
function makeGlyph(name, unicode, parts, fixedAdv) {
  if (fixedAdv) {                                  // 한글: 고정 폭, 가운데 맞춤
    const shift = fixedAdv / 2 - (HBOX.x0 + HBOX.x1) / 2 * U;
    return new opentype.Glyph({ name, unicode, advanceWidth: fixedAdv, path: partsPath(parts, shift) });
  }
  const { minX, maxX } = partsBounds(parts);
  return new opentype.Glyph({ name, unicode, advanceWidth: Math.round((maxX - minX) * U + SIDE * 2), path: partsPath(parts, SIDE - minX * U) });
}
const uniName = code => 'uni' + code.toString(16).toUpperCase().padStart(4, '0');

/* ---------- 기본 커닝: 글자 윤곽의 왼쪽·오른쪽 옆모습을 비교해 틈을 고르게 ---------- */
const BAND = 50, BANDS = 22, BAND_LO = -250;    // 폰트 단위 -250~850을 50단위 띠로
function profile(parts) {
  const { minX, maxX } = partsBounds(parts);
  const L = new Array(BANDS).fill(Infinity), R = new Array(BANDS).fill(-Infinity);
  const shift = SIDE - minX * U;
  parts.forEach(p => p.strokes.forEach(s => s.forEach(([x, y]) => {
    const fy = EM_TOP - y * U, rr = p.w / 2 * U, fx = x * U + shift;
    const b0 = Math.max(0, Math.floor((fy - rr - BAND_LO) / BAND)), b1 = Math.min(BANDS - 1, Math.floor((fy + rr - BAND_LO) / BAND));
    for (let b = b0; b <= b1; b++) { L[b] = Math.min(L[b], fx - rr); R[b] = Math.max(R[b], fx + rr); }
  })));
  return { L, R, adv: Math.round((maxX - minX) * U + SIDE * 2) };
}
function kernPairs(map = glyphs) {
  const prof = {};
  CHARS.forEach(c => { if (has(map, c)) prof[c] = profile(partsOf(map[c])); });
  const keys = Object.keys(prof), out = [];
  keys.forEach(a => keys.forEach(b => {
    const A = prof[a], B = prof[b];
    let gap = Infinity;
    for (let i = 0; i < BANDS; i++) for (let j = Math.max(0, i - 1); j <= Math.min(BANDS - 1, i + 1); j++) {   // 비스듬한 획은 이웃 띠까지
      if (A.R[i] > -Infinity && B.L[j] < Infinity) gap = Math.min(gap, A.adv - A.R[i] + B.L[j]);
    }
    if (gap === Infinity) return;                    // 높이가 안 겹치면(예: T와 .) 손대지 않음
    const lim = Math.min(220, Math.min(A.adv, B.adv) * .35);
    const v = Math.round(Math.max(-lim, -(gap - SIDE * 2) * .6) / 5) * 5;
    if (v <= -20) out.push([a, b, v]);
  }));
  return out;
}
// opentype.js 1.3.4는 kern 표를 쓰지 않아서, 만든 OTF에 kern(형식 0) 표를 직접 끼워 넣음
function addKernTable(buf, font, pairs) {
  if (!pairs.length) return buf;
  const idx = ch => font.charToGlyphIndex(ch);
  const list = pairs.map(([a, b, v]) => [idx(a), idx(b), v]).filter(p => p[0] > 0 && p[1] > 0).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const n = list.length, kern = new DataView(new ArrayBuffer(4 + 14 + n * 6));
  let es = 0; while ((2 << es) <= n) es++;
  const sr = (1 << es) * 6;
  kern.setUint16(0, 0); kern.setUint16(2, 1);
  kern.setUint16(4, 0); kern.setUint16(6, 14 + n * 6); kern.setUint16(8, 1);
  kern.setUint16(10, n); kern.setUint16(12, sr); kern.setUint16(14, es); kern.setUint16(16, n * 6 - sr);
  list.forEach(([l, r, v], k) => { kern.setUint16(18 + k * 6, l); kern.setUint16(20 + k * 6, r); kern.setInt16(22 + k * 6, v); });
  const src = new DataView(buf), num = src.getUint16(4), tables = [];
  for (let k = 0; k < num; k++) {
    const o = 12 + k * 16, tag = String.fromCharCode(...new Uint8Array(buf, o, 4));
    if (tag !== 'kern') tables.push({ tag, data: new Uint8Array(buf, src.getUint32(o + 8), src.getUint32(o + 12)) });
  }
  tables.push({ tag: 'kern', data: new Uint8Array(kern.buffer) });
  tables.sort((p, q) => (p.tag < q.tag ? -1 : 1));
  const T = tables.length, head = 12 + T * 16;
  let size = head; tables.forEach(t => { t.off = size; size += (t.data.length + 3) & ~3; });
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  let e2 = 0; while ((2 << e2) <= T) e2++;
  dv.setUint32(0, src.getUint32(0)); dv.setUint16(4, T); dv.setUint16(6, (1 << e2) * 16); dv.setUint16(8, e2); dv.setUint16(10, T * 16 - (1 << e2) * 16);
  const sum = (o, len) => { let s = 0; for (let k = 0; k < len; k += 4) s = (s + dv.getUint32(o + k)) >>> 0; return s; };
  tables.forEach((t, k) => {
    out.set(t.data, t.off);
    if (t.tag === 'head') dv.setUint32(t.off + 8, 0);
    const o = 12 + k * 16;
    for (let c = 0; c < 4; c++) out[o + c] = t.tag.charCodeAt(c);
    dv.setUint32(o + 4, sum(t.off, (t.data.length + 3) & ~3)); dv.setUint32(o + 8, t.off); dv.setUint32(o + 12, t.data.length);
  });
  const ht = tables.find(t => t.tag === 'head');
  if (ht) dv.setUint32(ht.off + 8, (0xB1B0AFBA - sum(0, size)) >>> 0);
  return out.buffer;
}

/* ---------- 폰트 만들기 ----------
   opts.alt: 모양 2를 기본 글자 자리에 넣음(미리보기에서 섞어 쓰는 두 번째 폰트)
   opts.hangul: 넣을 한글 완성형 글자 목록
   opts.salt: 모양 2를 따로 넣고 '스타일 대체(salt)' 기능으로 연결(내보내기용) */
function buildFont(opts = {}) {
  const notdef = new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() });
  const space = new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 280, path: new opentype.Path() });
  const list = [notdef, space], alts = [];
  CHARS.forEach(ch => {
    const g = opts.alt ? (altGlyph(ch) || (has(glyphs, ch) && glyphs[ch])) : (has(glyphs, ch) && glyphs[ch]);
    if (!g) return;
    const code = ch.codePointAt(0);
    list.push(makeGlyph(uniName(code), code, partsOf(g)));
    if (opts.salt) { const a = altGlyph(ch); if (a) alts.push([list.length - 1, makeGlyph(uniName(code) + '.alt', undefined, partsOf(a))]); }
  });
  (opts.hangul || []).forEach(ch => {
    const parts = composeParts(ch);
    if (parts) list.push(makeGlyph(uniName(ch.codePointAt(0)), ch.codePointAt(0), parts, 1000));
  });
  const base = list.length;
  alts.forEach(([, g]) => list.push(g));
  // CFF 이름(PostScript 이름)은 영문·숫자만 허용 — 한글 이름을 그대로 넣으면 브라우저·OS가 폰트를 거부함
  const ps = ((fontName || '').replace(/[^A-Za-z0-9]/g, '') || 'MyHandwriting').slice(0, 28) + '-Regular';
  const font = new opentype.Font({ familyName: fontName || 'MyHand', styleName: 'Regular', postScriptName: ps, unitsPerEm: 1000, ascender: 850, descender: -250, glyphs: list });
  alts.forEach(([from], k) => {
    font.substitution.add('salt', { sub: from, by: base + k });
    font.substitution.add('ss01', { sub: from, by: base + k });
  });
  return font;
}
function fontBuffer(opts = {}) {
  const font = buildFont(opts);
  let buf = font.toArrayBuffer();
  if (opts.kern) buf = addKernTable(buf, font, kernPairs());
  return buf;
}

let fontSeq = 0;
async function loadFace(buf) {
  const family = 'MyHandPreview' + (++fontSeq);
  const ff = new FontFace(family, buf);
  await ff.load();
  document.fonts.add(ff);
  return family;
}
async function loadPreviewFont(text = '') {
  if (!window.opentype || (!doneCount() && !jamoCount())) return null;
  const hangul = [...new Set([...text])].filter(canCompose);
  return loadFace(buildFont({ hangul }).toArrayBuffer());
}
async function loadPreviewFonts(text = '') {
  const main = await loadPreviewFont(text);
  if (!main) return { main: null, alt: null };
  const anyAlt = CHARS.some(c => altGlyph(c));
  return { main, alt: anyAlt ? await loadFace(buildFont({ alt: true }).toArrayBuffer()) : null };
}
// 문장 속 글자마다 모양 1/2 고르기: 같은 글자가 이어지면 반드시 번갈아, 나머지는 씨앗값으로 무작위
function pickShapes(text, seed) {
  const r = rng(seed), out = [];
  [...text].forEach((ch, k) => {
    const prev = k ? [...text][k - 1] : null;
    out.push(prev === ch ? 1 - out[k - 1] : (r() < .5 ? 0 : 1));
  });
  return out;
}

/* ---------- 캔버스에 획 그리기(그리기 화면·조합 미리보기·카드 공용) ---------- */
function paintParts(ctx, parts, color, scale = 1, ox = 0, oy = 0) {
  ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  parts.forEach(p => {
    ctx.lineWidth = p.w * scale;
    p.strokes.forEach(s => {
      ctx.beginPath();
      s.forEach(([x, y], k) => (k ? ctx.lineTo(ox + x * scale, oy + y * scale) : ctx.moveTo(ox + x * scale, oy + y * scale)));
      if (s.length === 1) ctx.lineTo(ox + s[0][0] * scale + .1, oy + s[0][1] * scale);
      ctx.stroke();
    });
  });
}
function partsForChar(ch, shape = 0) {
  if (decompose(ch)) return composeParts(ch);
  const g = shape ? (altGlyph(ch) || glyphs[ch]) : glyphs[ch];
  return g && g.strokes.length ? partsOf(g) : null;
}
// 한 줄을 캔버스에 직접 쓰기(폰트를 거치지 않아 카드 이미지가 외부 도구 없이 만들어짐)
function paintLine(ctx, text, x, y, px, opts = {}) {
  const sc = px / 1000 * U;                      // 폰트 1000단위 = px
  const shapes = pickShapes(text, opts.seed || 1);
  const kp = opts.kern ? Object.fromEntries(kernPairs().map(([a, b, v]) => [a + b, v])) : {};
  let cx = x, prev = null;
  [...text].forEach((ch, k) => {
    if (prev && kp[prev + ch]) cx += kp[prev + ch] / U * sc;
    prev = ch;
    if (ch === ' ') { cx += 280 / U * sc; return; }
    const parts = partsForChar(ch, opts.mix ? shapes[k] : 0);
    if (!parts) { ctx.fillStyle = '#c6c6cf'; ctx.font = `${px * .8}px sans-serif`; ctx.fillText(ch, cx, y); cx += px * .6; prev = null; return; }
    if (decompose(ch)) { paintParts(ctx, parts, opts.color || '#1b1b22', sc, cx + 500 / U * sc - (HBOX.x0 + HBOX.x1) / 2 * sc, y - yOf(0) * sc); cx += 1000 / U * sc; prev = null; return; }
    const { minX, maxX } = partsBounds(parts);
    paintParts(ctx, parts, opts.color || '#1b1b22', sc, cx + SIDE / U * sc - minX * sc, y - yOf(0) * sc);
    cx += ((maxX - minX) + SIDE * 2 / U) * sc;
  });
  return cx - x;
}

/* ---------- 랜딩 ---------- */
Router.on('/', root => {
  const wrap = h('<div class="split center"></div>');
  root.append(wrap);
  wrap.append(h(`
    <section class="hero">
      <div class="sample">Hello, my font!</div>
      <h1>내 글씨가<br>진짜 폰트가 돼요</h1>
      <p class="muted">화면에 글자를 하나씩 그리면 PC에 설치해서 쓸 수 있는 폰트 파일로 만들어 드려요.</p>
      <div class="badges"><span class="chip">〰 획 곡선 다듬기</span><span class="chip">🎲 같은 글자도 두 모양</span><span class="chip">↔ 자동 커닝</span><span class="chip">🧪 한글 자모 조합</span></div>
      <a class="btn primary big block" href="#/draw">${doneCount() ? `이어서 그리기 (${doneCount()}/${CHARS.length})` : '글자 그리러 가기'}</a>
    </section>
    `));
  wrap.append(h(`
    <section class="steps">
      <div class="card"><b>1. 그리기</b><p class="muted small">영문·숫자·기호 ${CHARS.length}자. 몇 글자만 그려도 미리보기가 돼요. 삐뚤빼뚤한 선은 곡선으로 다듬어 줘요.</p></div>
      <div class="card"><b>2. 미리보기</b><p class="muted small">문장을 넣으면 내 글씨로 바로 보여요. 같은 글자도 두 가지 모양이 섞여 진짜 손글씨 같아요.</p></div>
      <div class="card"><b>3. 내려받기</b><p class="muted small">OTF 파일을 받아 설치하면 메모장·워드에서도 써요. 글자 사이 간격(커닝)도 자동으로 맞춰요.</p></div>
    </section>`));
  root.append(h(`<div class="notice">🧪 한글 실험: 자음 14개·모음 14개만 그리면 쌍자음·겹받침·겹모음까지 조합해 완성형 글자(받침 없는 글자 전부 + 자주 쓰는 받침 글자)를 만들어요. 자동 배치라 글자에 따라 어색할 수 있어요.</div>`));
});

/* ---------- 그리기 ---------- */
Router.on('/draw', (root, params) => {
  let idx = Math.max(0, ALL.indexOf(params.get('c') || CHARS.find(c => !has(glyphs, c)) || 'A'));
  let shape = 0;                                          // 0 = 모양 1, 1 = 모양 2
  root.append(h(`
    <section class="stack">
      <div class="row"><h2 style="margin:0">글자 그리기</h2><span class="grow"></span><span class="muted small" id="cnt"></span></div>
      <div class="split s37"><div class="stack">
        <div class="seg" role="group" aria-label="글자 모양"><button class="chip" id="sh0" aria-pressed="true">모양 1</button><button class="chip" id="sh1" aria-pressed="false" title="같은 글자를 한 번 더 그리면 문장에서 두 모양이 섞여요">모양 2 (변형)</button></div>
        <div class="pad-wrap">
          <div class="target" id="target"></div>
          <canvas id="pad" width="${CANVAS}" height="${CANVAS}"></canvas>
        </div>
        <p class="muted small" id="hint"></p>
      </div>
      <div class="stack">
      <div class="row"><button class="btn" id="prev" title="이전 글자 (←)">←</button><button class="btn grow" id="undo" title="Ctrl+Z">되돌리기</button><button class="btn" id="redo" title="다시 실행 (Ctrl+Y)">↪</button><button class="btn grow" id="clear" title="Delete">지우기</button><button class="btn primary" id="next" title="다음 글자 (→)">다음 →</button></div>
      <p class="muted small">단축키: Ctrl+Z 되돌리기 · Ctrl+Y 다시 실행 · Delete 이 글자 지우기 · ←/→ 글자 이동 · 글자 키를 누르면 그 글자로 이동</p>
      <div class="two"><div><label class="field" for="pen">펜 굵기 <b id="pv">${pen}</b></label><input type="range" id="pen" min="6" max="40" value="${pen}"></div>
      <div><label class="field" for="smooth">곡선 다듬기 <b id="smv">${SMOOTH_NAMES[smoothLv]}</b></label><input type="range" id="smooth" min="0" max="3" value="${smoothLv}"></div></div>
      <b class="small">영문·숫자·기호</b>
      <div class="charmap" id="map"></div>
      <b class="small">🧪 한글 자모(실험) <span class="muted" id="jcnt"></span></b>
      <div class="charmap" id="jmap"></div>
      <div class="card combo hidden" id="combo"><div class="row"><b class="small">조합 미리보기</b><span class="grow"></span><span class="muted small" id="cmiss"></span></div><canvas id="cpv" width="720" height="130"></canvas></div>
      <a class="btn block" href="#/preview">미리보기로 →</a>
      </div></div>
    </section>`));
  const pad = $('#pad'), c2 = pad.getContext('2d');
  let current = null;
  let redo = [];                                           // 다시 실행할 획(글자를 바꾸거나 새로 그리면 비움)
  const ch = () => ALL[idx];
  const isJamo = () => JAMO.includes(ch());
  const map = () => (shape && !isJamo() ? glyphs2 : glyphs);
  const g = () => (map()[ch()] = map()[ch()] || { w: pen, strokes: [] });

  function draw() {
    c2.clearRect(0, 0, CANVAS, CANVAS);
    c2.font = '14px Pretendard, sans-serif';
    if (isJamo()) {
      c2.strokeStyle = '#dde1ef'; c2.lineWidth = 1.5; c2.setLineDash([8, 8]);
      c2.strokeRect(60, 60, CANVAS - 120, CANVAS - 120);
      c2.fillStyle = '#b3b9d4'; c2.fillText('칸을 채우듯 크게 — 위치·크기는 글자마다 자동으로 맞춰요', 66, 50);
    } else {
      GUIDES.forEach(gd => {
        const y = yOf(gd.u);
        c2.strokeStyle = gd.u === 0 ? '#9aa3c7' : '#dde1ef';
        c2.lineWidth = gd.u === 0 ? 2 : 1.5;
        c2.setLineDash(gd.u === 0 ? [] : [8, 8]);
        c2.beginPath(); c2.moveTo(0, y); c2.lineTo(CANVAS, y); c2.stroke();
        c2.fillStyle = '#b3b9d4'; c2.fillText(gd.name, 8, y - 6);
      });
    }
    c2.setLineDash([]);
    // 흐린 견본 글자
    c2.fillStyle = 'rgba(80,90,140,.08)';
    c2.textAlign = 'center'; c2.textBaseline = 'alphabetic';
    if (isJamo()) { c2.font = `440px Pretendard, sans-serif`; c2.fillText(ch(), CANVAS / 2, 470); }
    else { c2.font = `${700 / U * 1.02}px Pretendard, sans-serif`; c2.fillText(ch(), CANVAS / 2, yOf(0)); }
    c2.textAlign = 'left';
    // 모양 2를 그릴 때는 모양 1을 옅게 깔아 줌
    if (shape && !isJamo() && has(glyphs, ch())) paintParts(c2, partsOf(glyphs[ch()]), 'rgba(234,88,12,.18)');
    const gl = map()[ch()];
    if (gl && gl.strokes.length) paintParts(c2, partsOf(gl), '#1b1b22');
    if (current) paintParts(c2, [{ w: gl && gl.strokes.length ? gl.w : pen, strokes: [current] }], '#1b1b22');
    if (isJamo()) drawCombo();
  }
  function drawCombo() {
    const cv = $('#cpv'), cx = cv.getContext('2d');
    cx.clearRect(0, 0, cv.width, cv.height);
    const sample = ['가', '나', '한', '글', '꽃', '봐', '없', '의'];
    const sc = 88 / (HBOX.y1 - HBOX.y0);
    const missing = new Set();
    sample.forEach((s, k) => {
      const parts = composeParts(s), x = 8 + k * 89;
      if (parts) paintParts(cx, parts, '#1b1b22', sc, x - HBOX.x0 * sc, 20 - HBOX.y0 * sc);
      else { needJamo(s).filter(j => !has(glyphs, j)).forEach(j => missing.add(j)); cx.fillStyle = '#d4d4dc'; cx.font = '64px Pretendard, sans-serif'; cx.fillText(s, x + 10, 95); }
    });
    $('#cmiss').textContent = missing.size ? `더 그릴 자모: ${[...missing].join(' ')}` : '샘플 글자 모두 조합 완료!';
  }
  function renderMap() {
    $('#target').textContent = ch() + (shape && !isJamo() ? '²' : '');
    $('#cnt').textContent = `${doneCount()} / ${CHARS.length} 완료`;
    $('#jcnt').textContent = `${jamoCount()} / ${JAMO.length}`;
    const cell = c => { const k = ALL.indexOf(c); return `<button class="cm ${has(glyphs, c) ? 'done' : ''} ${has(glyphs2, c) ? 'alt' : ''} ${k === idx ? 'cur' : ''}" data-k="${k}" aria-label="${esc(c)}${has(glyphs, c) ? ' (그림)' : ''}">${esc(c)}</button>`; };
    $('#map').innerHTML = CHARS.map(cell).join('');
    $('#jmap').innerHTML = JAMO.map(cell).join('');
    $$('#map .cm, #jmap .cm').forEach(b => b.onclick = () => { idx = Number(b.dataset.k); redo = []; renderMap(); draw(); });
    $('#sh0').setAttribute('aria-pressed', String(!shape)); $('#sh1').setAttribute('aria-pressed', String(!!shape));
    $('#sh1').disabled = isJamo();
    $('#combo').classList.toggle('hidden', !isJamo());
    $('#hint').textContent = isJamo() ? '한글은 실험 기능이에요. 자모를 그리면 아래에서 바로 글자로 조합돼요.'
      : shape ? (has(glyphs2, ch()) ? '모양 2를 그렸어요. 문장에서 모양 1과 번갈아 나와요.' : '옅은 주황색이 모양 1이에요. 살짝 다르게 한 번 더 써 보세요. (안 그리면 자동 변형을 써요)')
      : '안쪽 선은 그리는 대로, 다 그린 획은 곡선으로 다듬어져요.';
  }
  const setShape = s => { if (isJamo()) s = 0; shape = s; redo = []; renderMap(); draw(); };
  $('#sh0').onclick = () => setShape(0);
  $('#sh1').onclick = () => setShape(1);
  const pos = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * CANVAS / r.width, (e.clientY - r.top) * CANVAS / r.height]; };
  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    const gl = g();
    if (!gl.strokes.length) gl.w = pen;
    current = [pos(e)]; draw();
  });
  pad.addEventListener('pointermove', e => {
    if (!current) return;
    const p = pos(e), last = current[current.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 4) { current.push(p.map(v => Math.round(v * 10) / 10)); draw(); }
  });
  const finish = () => {
    if (!current) return;
    g().strokes.push(current); current = null; redo = []; saveGlyphs(); draw(); renderMap();
  };
  pad.addEventListener('pointerup', finish);
  pad.addEventListener('pointercancel', finish);
  const undo = () => { const gl = map()[ch()]; if (gl && gl.strokes.length) { redo.push(gl.strokes.pop()); saveGlyphs(); draw(); renderMap(); } };
  const redoFn = () => { if (redo.length) { g().strokes.push(redo.pop()); saveGlyphs(); draw(); renderMap(); } };
  const clearGlyph = () => { const gl = map()[ch()]; if (gl) { redo = gl.strokes.slice().reverse(); delete map()[ch()]; saveGlyphs(); draw(); renderMap(); } };
  const goto = k => { idx = (k + ALL.length) % ALL.length; redo = []; if (isJamo()) shape = 0; renderMap(); draw(); };
  $('#undo').onclick = undo;
  $('#redo').onclick = redoFn;
  $('#clear').onclick = clearGlyph;
  $('#prev').onclick = () => goto(idx - 1);
  $('#next').onclick = () => goto(idx + 1);
  const onKey = e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redoFn(); }
    else if (mod || e.altKey) return;
    else if (e.key === 'Backspace') { e.preventDefault(); undo(); }
    else if (e.key === 'Delete') { e.preventDefault(); clearGlyph(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goto(idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goto(idx + 1); }
    else if (e.key.length === 1 && ALL.includes(e.key)) { e.preventDefault(); goto(ALL.indexOf(e.key)); }
  };
  addEventListener('keydown', onKey);
  $('#pen').oninput = e => {
    pen = Number(e.target.value); $('#pv').textContent = pen; store.set('fm-pen', pen);
    const gl = map()[ch()]; if (gl) { gl.w = pen; saveGlyphs(); } draw();
  };
  $('#smooth').oninput = e => { smoothLv = Number(e.target.value); $('#smv').textContent = SMOOTH_NAMES[smoothLv]; store.set('fm-smooth', smoothLv); draw(); };
  renderMap(); draw();
  return () => removeEventListener('keydown', onKey);
});

/* ---------- 미리보기 ---------- */
Router.on('/preview', root => {
  root.append(h(`
    <section class="stack">
      <h1>미리보기</h1>
      <textarea id="txt" rows="3" aria-label="미리볼 문장">The quick brown fox jumps over the lazy dog. 0123456789!
Hello, Coffee? AVATAR Typo
안녕하세요 반가워요</textarea>
      <div class="row wrap">
        <label class="chip"><input type="checkbox" id="mix" ${mixAlt ? 'checked' : ''}> 🎲 모양 섞기</label>
        <button class="chip" id="reseed" title="모양 1·2를 다시 섞기">다시 섞기</button>
        <label class="chip"><input type="checkbox" id="kern" ${useKern ? 'checked' : ''}> ↔ 자동 커닝</label>
        <label class="chip"><input type="checkbox" id="auto" ${autoAlt ? 'checked' : ''}> 모양 2 자동 변형</label>
      </div>
      <div><label class="field" for="sz">크기 <b id="szv">48</b>px</label><input type="range" id="sz" min="20" max="120" value="48"></div>
      <div class="card pv" id="pv" aria-live="polite"></div>
      <p class="muted small">아직 안 그린 글자는 <span class="missing">회색</span>으로 보여요. ${doneCount()} / ${CHARS.length}자 · 한글 자모 ${jamoCount()} / ${JAMO.length} · <span id="kinfo"></span></p>
      <p class="muted small hidden" id="hmiss"></p>
      <div class="row"><a class="btn grow" href="#/draw">← 더 그리기</a><a class="btn primary grow" href="#/export">내보내기 →</a></div>
    </section>`));
  let fam = { main: null, alt: null }, seed = 1, kp = {}, loading = 0;
  const refreshKern = () => { const pairs = kernPairs(); kp = Object.fromEntries(pairs.map(([a, b, v]) => [a + b, v])); $('#kinfo').textContent = `커닝 ${pairs.length}쌍`; };
  const render = () => {
    const size = $('#sz').value, text = $('#txt').value;
    $('#szv').textContent = size;
    $('#pv').style.fontSize = size + 'px';
    const shapes = pickShapes(text, seed), chars = [...text];
    $('#pv').innerHTML = chars.map((ch, k) => {
      if (ch === '\n') return '<br>';
      if (ch === ' ') return ' ';
      const hangul = !!decompose(ch);
      const ok = fam.main && (hangul ? canCompose(ch) : has(glyphs, ch));
      if (!ok) return `<span class="missing">${esc(ch)}</span>`;
      const useAlt = !hangul && mixAlt && fam.alt && shapes[k] && altGlyph(ch);
      const kv = useKern && k && kp[chars[k - 1] + ch];
      return `<span class="gl${useAlt ? ' alt' : ''}" style="font-family:'${useAlt ? fam.alt : fam.main}'${kv ? `;margin-left:${kv / 1000}em` : ''}">${esc(ch)}</span>`;
    }).join('');
    const miss = new Set(); chars.forEach(c => decompose(c) && needJamo(c).forEach(j => !has(glyphs, j) && miss.add(j)));
    $('#hmiss').textContent = miss.size ? `🧪 한글을 보려면 자모를 더 그려 주세요: ${[...miss].join(' ')}` : '';
    $('#hmiss').classList.toggle('hidden', !miss.size);
  };
  const reload = () => {
    const my = ++loading;
    loadPreviewFonts($('#txt').value).then(f => { if (my === loading) { fam = f; render(); } }).catch(() => toast('미리보기 폰트를 만들지 못했어요'));
  };
  let t = 0;
  $('#txt').oninput = () => { render(); clearTimeout(t); t = setTimeout(reload, 400); };
  $('#sz').oninput = render;
  $('#mix').onchange = e => { mixAlt = e.target.checked; store.set('fm-mix', mixAlt); render(); };
  $('#reseed').onclick = () => { seed = (seed * 48271 + 11) % 2147483647; render(); };
  $('#kern').onchange = e => { useKern = e.target.checked; store.set('fm-kern', useKern); render(); };
  $('#auto').onchange = e => { autoAlt = e.target.checked; store.set('fm-autoalt', autoAlt); reload(); };
  refreshKern(); render(); reload();
});

/* ---------- 내보내기 ---------- */
Router.on('/export', root => {
  const n = doneCount();
  root.append(h(`
    <section class="stack">
      <h1>내 폰트 내려받기</h1>
      <div class="card stack">
        <div><label class="field" for="fname">폰트 이름</label><input id="fname" type="text" maxlength="24" value="${esc(fontName)}"></div>
        <p class="muted small">${n} / ${CHARS.length}자를 담아요. 안 그린 글자는 설치 후 다른 기본 글꼴로 대신 보여요.</p>
        <label class="small opt"><input type="checkbox" id="xk" ${useKern ? 'checked' : ''}> ↔ 자동 커닝 넣기 <span class="muted" id="xkn"></span></label>
        <label class="small opt"><input type="checkbox" id="xa" checked> 🎲 모양 2 넣기(글꼴 기능 '스타일 대체'·ss01로 켜기)</label>
        <label class="small opt"><input type="checkbox" id="xh" ${jamoCount() ? 'checked' : ''} ${jamoCount() ? '' : 'disabled'}> 🧪 한글 조합 글자 넣기 <span class="muted" id="xhn"></span></label>
        <div id="xtw" class="${jamoCount() ? '' : 'hidden'}"><label class="field" for="xt">꼭 넣을 한글 문장(선택)</label><input id="xt" type="text" maxlength="200" placeholder="예: 우리 팀 화이팅"></div>
        <button class="btn primary big block" id="dl" ${n || jamoCount() ? '' : 'disabled'}>OTF 파일 받기</button>
      </div>
      <div class="card"><b>설치 방법</b>
        <ul class="small"><li>Windows: 받은 파일을 더블클릭 → "설치"</li><li>Mac: 더블클릭 → 서체 관리자에서 "설치"</li><li>메모장·워드에서 글꼴 목록에 "${esc(fontName)}"가 생겨요</li><li>모양 2는 워드의 글꼴 고급 설정(스타일 세트), 디자인 앱의 '대체 글자'에서 골라 쓸 수 있어요</li></ul></div>
      <button class="btn block" id="card" ${n ? '' : 'disabled'}>내 글씨 카드 이미지 저장</button>
      <canvas id="sc" class="sccanvas hidden" width="1120" height="600" aria-label="내 글씨 카드"></canvas>
    </section>`));
  $('#xkn').textContent = `(${kernPairs().length}쌍)`;
  const updH = () => { $('#xhn').textContent = jamoCount() ? `(${hangulSet($('#xt').value).length}자 · 자모 ${jamoCount()}/${JAMO.length})` : '(자모를 먼저 그려 주세요)'; };
  updH();
  $('#xt').oninput = updH;
  $('#fname').oninput = e => { fontName = e.target.value.trim() || '내손글씨'; store.set('fm-name', fontName); };
  $('#dl').onclick = () => {
    try {
      const buf = fontBuffer({ kern: $('#xk').checked, salt: $('#xa').checked, hangul: $('#xh').checked ? hangulSet($('#xt').value) : [] });
      download(new Blob([buf], { type: 'font/otf' }), (fontName || 'MyHand').replace(/[\\/:*?"<>|]/g, '') + '.otf');
      toast(`폰트를 만들었어요 (${Math.round(buf.byteLength / 1024)}KB)`);
    } catch (e) { toast('폰트를 만들지 못했어요: ' + e.message); }
  };
  $('#card').onclick = async () => {
    const sc = $('#sc'), cx = sc.getContext('2d');
    cx.fillStyle = '#fffaf2'; cx.fillRect(0, 0, sc.width, sc.height);
    cx.fillStyle = '#ea580c'; cx.fillRect(0, 0, sc.width, 14);
    // 너비를 먼저 재고 가운데에 그리기
    const meas = document.createElement('canvas').getContext('2d');
    const w1 = paintLine(meas, 'Hello World', 0, 0, 120, { kern: useKern, mix: mixAlt, seed: 7 });
    const px = w1 > 1000 ? 120 * 1000 / w1 : 120;
    const w2 = paintLine(meas, 'Hello World', 0, 0, px, { kern: useKern, mix: mixAlt, seed: 7 });
    paintLine(cx, 'Hello World', (sc.width - w2) / 2, 300, px, { kern: useKern, mix: mixAlt, seed: 7 });
    const sub = JAMO.every(j => has(glyphs, j)) ? '안녕 내 글씨' : '';
    if (sub) { const w3 = paintLine(meas, sub, 0, 0, 70, {}); paintLine(cx, sub, (sc.width - w3) / 2, 440, 70, {}); }
    cx.fillStyle = '#8a7f70'; cx.font = '28px Pretendard, sans-serif'; cx.textAlign = 'center';
    cx.fillText(`${fontName} · 내 손글씨 폰트`, sc.width / 2, 545);
    sc.classList.remove('hidden');
    await saveImage(sc, 'my-font-card.png');
  };
});

Router.start($('#app'));
