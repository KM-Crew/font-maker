/* 내 손글씨 폰트 — 캔버스에 그린 글자로 실제 폰트 파일(OTF) 만들기
   그린 획은 이 기기(localStorage)에만 저장됩니다. */
'use strict';

const CHARS = ('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + '.,!?\'"-():;=').split('');
const CANVAS = 600;          // 캔버스 내부 크기(px)
const EM_TOP = 850;          // 캔버스 맨 위 = 폰트 좌표 850
const EM_SPAN = 1100;        // 캔버스 높이 = 1100 폰트 단위
const U = EM_SPAN / CANVAS;  // 1px 당 폰트 단위
const yOf = units => (EM_TOP - units) / U;  // 폰트 단위 → 캔버스 y
const GUIDES = [{ u: 700, name: '대문자 높이' }, { u: 480, name: 'x 높이' }, { u: 0, name: '기준선' }, { u: -200, name: '아래' }];

let glyphs = store.get('fm-glyphs', {});   // { "A": { w: 펜굵기, strokes: [[[x,y],...], ...] } }
let fontName = store.get('fm-name', '내손글씨');
let pen = store.get('fm-pen', 18);
const saveGlyphs = () => store.set('fm-glyphs', glyphs);
const doneCount = () => CHARS.filter(c => glyphs[c] && glyphs[c].strokes.length).length;

/* ---------- 획 → 폰트 윤곽선 ---------- */
function circlePts(x, y, r, n = 10) {
  const pts = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  return pts;
}
function strokeContours(stroke, w) {
  // 각 점은 원, 이웃한 점 사이는 사각형. 모두 같은 방향(반시계)으로 감아 겹치는 부분이 합쳐지게 함.
  const r = w / 2, out = [];
  stroke.forEach(([x, y]) => out.push(circlePts(x, y, r)));
  for (let k = 1; k < stroke.length; k++) {
    const [x1, y1] = stroke[k - 1], [x2, y2] = stroke[k];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < .5) continue;
    const nx = -dy / len * r, ny = dx / len * r;
    out.push([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
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
function glyphBounds(g) {
  let minX = Infinity, maxX = -Infinity;
  g.strokes.forEach(s => s.forEach(([x]) => { minX = Math.min(minX, x - g.w / 2); maxX = Math.max(maxX, x + g.w / 2); }));
  return { minX, maxX };
}
function buildFont() {
  const notdef = new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() });
  const space = new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: 280, path: new opentype.Path() });
  const list = [notdef, space];
  CHARS.forEach(ch => {
    const g = glyphs[ch];
    if (!g || !g.strokes.length) return;
    const { minX, maxX } = glyphBounds(g);
    const side = 50;                                 // 양옆 여백(폰트 단위)
    const shift = side - minX * U;
    const path = new opentype.Path();
    g.strokes.forEach(s => strokeContours(s, g.w).forEach(poly => {
      const pts = toFontPts(poly);
      pts.forEach(([x, y], k) => (k ? path.lineTo(x + shift, y) : path.moveTo(x + shift, y)));
      path.close();
    }));
    const code = ch.codePointAt(0);
    list.push(new opentype.Glyph({ name: 'uni' + code.toString(16).toUpperCase().padStart(4, '0'), unicode: code, advanceWidth: Math.round((maxX - minX) * U + side * 2), path }));
  });
  return new opentype.Font({ familyName: fontName || 'MyHand', styleName: 'Regular', unitsPerEm: 1000, ascender: 850, descender: -250, glyphs: list });
}
let fontSeq = 0;
async function loadPreviewFont() {
  if (!window.opentype || !doneCount()) return null;
  const buf = buildFont().toArrayBuffer();
  const family = 'MyHandPreview' + (++fontSeq);
  const ff = new FontFace(family, buf);
  await ff.load();
  document.fonts.add(ff);
  return family;
}

/* ---------- 랜딩 ---------- */
Router.on('/', root => {
  root.append(h(`
    <section class="hero">
      <div class="sample">Hello, my font!</div>
      <h1>내 글씨가<br>진짜 폰트가 돼요</h1>
      <p class="muted">화면에 글자를 하나씩 그리면 PC에 설치해서 쓸 수 있는 폰트 파일로 만들어 드려요.</p>
      <a class="btn primary big block" href="#/draw">${doneCount() ? `이어서 그리기 (${doneCount()}/${CHARS.length})` : '글자 그리러 가기'}</a>
    </section>
    `));
  root.append(h(`
    <section class="steps">
      <div class="card"><b>1. 그리기</b><p class="muted small">영문·숫자·기호 ${CHARS.length}자. 몇 글자만 그려도 미리보기가 돼요.</p></div>
      <div class="card"><b>2. 미리보기</b><p class="muted small">문장을 넣으면 내 글씨로 바로 보여요.</p></div>
      <div class="card"><b>3. 내려받기</b><p class="muted small">OTF 파일을 받아 설치하면 메모장·워드에서도 써요.</p></div>
    </section>`));
  root.append(h(`<div class="notice">한글은 글자 수가 많아(완성형 2,350자) 지금은 영문·숫자만 지원해요. 자음·모음을 조합하는 한글 실험 기능은 다음 버전에서 시도할 예정이에요.</div>`));
});

/* ---------- 그리기 ---------- */
Router.on('/draw', (root, params) => {
  let idx = Math.max(0, CHARS.indexOf(params.get('c') || CHARS.find(c => !glyphs[c]?.strokes.length) || 'A'));
  root.append(h(`
    <section class="stack">
      <div class="row"><h2 style="margin:0">글자 그리기</h2><span class="grow"></span><span class="muted small" id="cnt"></span></div>
      <div class="pad-wrap">
        <div class="target" id="target"></div>
        <canvas id="pad" width="${CANVAS}" height="${CANVAS}"></canvas>
      </div>
      <div class="row"><button class="btn" id="prev">←</button><button class="btn grow" id="undo">되돌리기</button><button class="btn grow" id="clear">지우기</button><button class="btn primary" id="next">다음 →</button></div>
      <div><label class="field">펜 굵기 <b id="pv">${pen}</b></label><input type="range" id="pen" min="6" max="40" value="${pen}"></div>
      <div class="charmap" id="map"></div>
      <a class="btn block" href="#/preview">미리보기로 →</a>
    </section>`));
  const pad = $('#pad'), c2 = pad.getContext('2d');
  let current = null;
  const g = () => (glyphs[CHARS[idx]] = glyphs[CHARS[idx]] || { w: pen, strokes: [] });

  function draw() {
    c2.clearRect(0, 0, CANVAS, CANVAS);
    c2.font = '14px Pretendard, sans-serif';
    GUIDES.forEach(gd => {
      const y = yOf(gd.u);
      c2.strokeStyle = gd.u === 0 ? '#9aa3c7' : '#dde1ef';
      c2.lineWidth = gd.u === 0 ? 2 : 1.5;
      c2.setLineDash(gd.u === 0 ? [] : [8, 8]);
      c2.beginPath(); c2.moveTo(0, y); c2.lineTo(CANVAS, y); c2.stroke();
      c2.fillStyle = '#b3b9d4'; c2.fillText(gd.name, 8, y - 6);
    });
    c2.setLineDash([]);
    // 흐린 견본 글자
    c2.fillStyle = 'rgba(80,90,140,.08)';
    c2.font = `${700 / U * 1.02}px Pretendard, sans-serif`;
    c2.textAlign = 'center'; c2.textBaseline = 'alphabetic';
    c2.fillText(CHARS[idx], CANVAS / 2, yOf(0));
    c2.textAlign = 'left';
    const gl = glyphs[CHARS[idx]];
    c2.strokeStyle = '#1b1b22'; c2.lineCap = 'round'; c2.lineJoin = 'round';
    (gl ? gl.strokes : []).concat(current ? [current] : []).forEach(s => {
      c2.lineWidth = gl ? gl.w : pen;
      c2.beginPath();
      s.forEach(([x, y], k) => (k ? c2.lineTo(x, y) : c2.moveTo(x, y)));
      if (s.length === 1) c2.lineTo(s[0][0] + .1, s[0][1]);
      c2.stroke();
    });
  }
  function renderMap() {
    $('#target').textContent = CHARS[idx];
    $('#cnt').textContent = `${doneCount()} / ${CHARS.length} 완료`;
    $('#map').innerHTML = CHARS.map((c, k) => `<button class="cm ${glyphs[c]?.strokes.length ? 'done' : ''} ${k === idx ? 'cur' : ''}" data-k="${k}">${esc(c)}</button>`).join('');
    $$('#map .cm').forEach(b => b.onclick = () => { idx = Number(b.dataset.k); renderMap(); draw(); });
  }
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
    g().strokes.push(current); current = null; saveGlyphs(); draw(); renderMap();
  };
  pad.addEventListener('pointerup', finish);
  pad.addEventListener('pointercancel', finish);
  $('#undo').onclick = () => { const gl = glyphs[CHARS[idx]]; if (gl) { gl.strokes.pop(); saveGlyphs(); draw(); renderMap(); } };
  $('#clear').onclick = () => { delete glyphs[CHARS[idx]]; saveGlyphs(); draw(); renderMap(); };
  $('#prev').onclick = () => { idx = (idx - 1 + CHARS.length) % CHARS.length; renderMap(); draw(); };
  $('#next').onclick = () => { idx = (idx + 1) % CHARS.length; renderMap(); draw(); };
  $('#pen').oninput = e => {
    pen = Number(e.target.value); $('#pv').textContent = pen; store.set('fm-pen', pen);
    const gl = glyphs[CHARS[idx]]; if (gl) { gl.w = pen; saveGlyphs(); } draw();
  };
  renderMap(); draw();
});

/* ---------- 미리보기 ---------- */
Router.on('/preview', root => {
  root.append(h(`
    <section class="stack">
      <h1>미리보기</h1>
      <textarea id="txt" rows="3">The quick brown fox jumps over the lazy dog. 0123456789!</textarea>
      <div><label class="field">크기 <b id="szv">48</b>px</label><input type="range" id="sz" min="20" max="120" value="48"></div>
      <div class="card pv" id="pv"></div>
      <p class="muted small">아직 안 그린 글자는 <span class="missing">회색</span>으로 보여요. ${doneCount()} / ${CHARS.length}자 완료</p>
      <div class="row"><a class="btn grow" href="#/draw">← 더 그리기</a><a class="btn primary grow" href="#/export">내보내기 →</a></div>
    </section>`));
  let family = null;
  const render = () => {
    const size = $('#sz').value;
    $('#szv').textContent = size;
    $('#pv').style.fontSize = size + 'px';
    $('#pv').innerHTML = [...$('#txt').value].map(ch => {
      if (ch === '\n') return '<br>';
      if (ch === ' ') return ' ';
      const ok = family && glyphs[ch]?.strokes.length;
      return ok ? `<span style="font-family:'${family}'">${esc(ch)}</span>` : `<span class="missing">${esc(ch)}</span>`;
    }).join('');
  };
  $('#txt').oninput = render; $('#sz').oninput = render;
  render();
  loadPreviewFont().then(f => { family = f; render(); }).catch(() => toast('미리보기 폰트를 만들지 못했어요'));
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
        <button class="btn primary big block" id="dl" ${n ? '' : 'disabled'}>OTF 파일 받기</button>
      </div>
      <div class="card"><b>설치 방법</b>
        <ul class="small"><li>Windows: 받은 파일을 더블클릭 → "설치"</li><li>Mac: 더블클릭 → 서체 관리자에서 "설치"</li><li>메모장·워드에서 글꼴 목록에 "${esc(fontName)}"가 생겨요</li></ul></div>
      <button class="btn block" id="card" ${n ? '' : 'disabled'}>내 글씨 카드 이미지 저장</button>
      <div class="sharecard hidden" id="sc"></div>
    </section>`));
  $('#fname').oninput = e => { fontName = e.target.value.trim() || '내손글씨'; store.set('fm-name', fontName); };
  $('#dl').onclick = () => {
    try {
      const font = buildFont();
      download(new Blob([font.toArrayBuffer()], { type: 'font/otf' }), (fontName || 'MyHand').replace(/[\\/:*?"<>|]/g, '') + '.otf');
    } catch (e) { toast('폰트를 만들지 못했어요: ' + e.message); }
  };
  $('#card').onclick = async () => {
    const fam = await loadPreviewFont();
    const sc = $('#sc');
    sc.innerHTML = `<div class="sct" style="font-family:'${fam}'">Hello World</div><div class="scs">${esc(fontName)} · 내 손글씨 폰트</div>`;
    sc.classList.remove('hidden');
    await document.fonts.ready;
    await saveImage(sc, 'my-font-card.png');
  };
});

Router.start($('#app'));
