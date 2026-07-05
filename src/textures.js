// textures.js — P.T.ライク廊下用プロシージャルテクスチャ群
// すべてCanvas 2D APIで描画。画像ファイル不使用。PS1風に低解像度・NearestFilter。

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

// シード付きPRNG（mulberry32）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// CanvasTexture化と共通設定
function toTexture(canvas, { tile = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  if (tile) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

// 高周波ノイズ：ピクセル単位の明度揺らぎ
function addPixelNoise(ctx, w, h, rand, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 2 * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// 低周波ムラ：半透明の放射グラデ楕円を重ねる。
// wrap=true ならタイル境界を跨いでも継ぎ目が出ないよう9方向に複製描画。
function addBlotches(ctx, w, h, rand, { count, rgb, alphaMin, alphaMax, rMin, rMax, wrap = false }) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = rMin + rand() * (rMax - rMin);
    const a = alphaMin + rand() * (alphaMax - alphaMin);
    const offsets = wrap
      ? [[0, 0], [-w, 0], [w, 0], [0, -h], [0, h], [-w, -h], [w, -h], [-w, h], [w, h]]
      : [[0, 0]];
    for (const [ox, oy] of offsets) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

// ---------------------------------------------------------------------------
// 壁紙
// ---------------------------------------------------------------------------

export function wallpaperTexture({ stained = 0, seed = 1 } = {}) {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const rand = mulberry32(seed);

  // 下地：くすんだクリーム
  ctx.fillStyle = '#cfc4a8';
  ctx.fillRect(0, 0, S, S);

  // かすかな縦ストライプ
  for (let x = 0; x < S; x += 16) {
    ctx.fillStyle = 'rgba(120,105,80,0.07)';
    ctx.fillRect(x, 0, 6, S);
  }

  // 小紋パターン（等間隔の小さな菱形ドット。格子間隔なのでタイル可能）
  ctx.fillStyle = 'rgba(140,120,90,0.16)';
  for (let y = 8; y < S; y += 32) {
    for (let x = 8; x < S; x += 32) {
      const ox = ((y / 32) | 0) % 2 === 0 ? 0 : 16;
      ctx.save();
      ctx.translate(x + ox, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }
  }

  // 経年の黄ばみムラ（低周波）
  addBlotches(ctx, S, S, rand, {
    count: 10, rgb: '150,120,60', alphaMin: 0.04, alphaMax: 0.1,
    rMin: 40, rMax: 110, wrap: true,
  });
  addBlotches(ctx, S, S, rand, {
    count: 6, rgb: '235,228,205', alphaMin: 0.05, alphaMax: 0.1,
    rMin: 50, rMax: 120, wrap: true,
  });

  // 汚れ・シミ（stainedに応じて増える）
  if (stained > 0) {
    // 黒ずみ
    addBlotches(ctx, S, S, rand, {
      count: Math.round(3 + stained * 12), rgb: '40,32,22',
      alphaMin: 0.05 * stained, alphaMax: 0.22 * stained,
      rMin: 15, rMax: 70, wrap: true,
    });
    // 雨染み（縦の筋。上下端でアルファ0にしてタイル継ぎ目を回避）
    const streaks = Math.round(2 + stained * 8);
    for (let i = 0; i < streaks; i++) {
      const x = rand() * S;
      const wStreak = 2 + rand() * 5;
      const top = rand() * S * 0.5;
      const len = S * (0.25 + rand() * 0.5);
      const a = (0.06 + rand() * 0.12) * stained;
      const g = ctx.createLinearGradient(0, top, 0, top + len);
      g.addColorStop(0, 'rgba(60,48,30,0)');
      g.addColorStop(0.3, `rgba(60,48,30,${a})`);
      g.addColorStop(1, 'rgba(60,48,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - wStreak / 2, top, wStreak, len);
    }
  }

  addPixelNoise(ctx, S, S, rand, 9);
  return toTexture(canvas, { tile: true });
}

// ---------------------------------------------------------------------------
// 床（フローリング）
// ---------------------------------------------------------------------------

export function floorTexture({ seed = 2 } = {}) {
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  const rand = mulberry32(seed);
  const plankW = 64; // 4枚。S割り切りでタイル可能

  // 下地：焦げ茶
  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(0, 0, S, S);

  for (let p = 0; p < S / plankW; p++) {
    const x0 = p * plankW;
    // 板ごとの色ムラ
    const tone = (rand() - 0.5) * 20;
    ctx.fillStyle = `rgb(${58 + tone},${42 + tone * 0.7},${28 + tone * 0.5})`;
    ctx.fillRect(x0, 0, plankW, S);

    // 木目（縦方向のうねった線。上下にはみ出す分は9方向複製で吸収）
    const grains = 6 + Math.floor(rand() * 5);
    for (let gLine = 0; gLine < grains; gLine++) {
      const gx = x0 + 4 + rand() * (plankW - 8);
      const amp = 1 + rand() * 3;
      const phase = rand() * Math.PI * 2;
      const dark = rand() > 0.5;
      ctx.strokeStyle = dark ? 'rgba(20,12,6,0.25)' : 'rgba(120,90,60,0.12)';
      ctx.lineWidth = 0.7 + rand() * 1.3;
      for (const oy of [-S, 0, S]) {
        ctx.beginPath();
        for (let y = 0; y <= S; y += 4) {
          const wx = gx + Math.sin((y / S) * Math.PI * 2 * 2 + phase) * amp;
          if (y === 0) ctx.moveTo(wx, y + oy);
          else ctx.lineTo(wx, y + oy);
        }
        ctx.stroke();
      }
    }

    // 節（板ごとに0〜2個）
    const knots = Math.floor(rand() * 2.4);
    for (let k = 0; k < knots; k++) {
      const kx = x0 + 10 + rand() * (plankW - 20);
      const ky = rand() * S;
      const kr = 3 + rand() * 5;
      for (const oy of [-S, 0, S]) {
        const g = ctx.createRadialGradient(kx, ky + oy, 0, kx, ky + oy, kr);
        g.addColorStop(0, 'rgba(15,9,4,0.75)');
        g.addColorStop(0.5, 'rgba(30,18,9,0.4)');
        g.addColorStop(1, 'rgba(30,18,9,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(kx, ky + oy, kr, kr * 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 板の継ぎ目（縦）
    ctx.fillStyle = 'rgba(10,6,3,0.8)';
    ctx.fillRect(x0, 0, 1.5, S);
    ctx.fillStyle = 'rgba(140,110,80,0.12)';
    ctx.fillRect(x0 + 1.5, 0, 1, S);

    // 横の継ぎ目（板の端。板ごとにランダム位置）
    const jy = Math.floor(rand() * S);
    ctx.fillStyle = 'rgba(10,6,3,0.7)';
    ctx.fillRect(x0, jy, plankW, 1.5);
  }

  // 艶ムラ（低周波の明暗）
  addBlotches(ctx, S, S, rand, {
    count: 7, rgb: '160,130,90', alphaMin: 0.04, alphaMax: 0.09,
    rMin: 40, rMax: 100, wrap: true,
  });
  addBlotches(ctx, S, S, rand, {
    count: 7, rgb: '10,6,3', alphaMin: 0.06, alphaMax: 0.14,
    rMin: 40, rMax: 110, wrap: true,
  });

  addPixelNoise(ctx, S, S, rand, 8);
  return toTexture(canvas, { tile: true });
}

// ---------------------------------------------------------------------------
// 天井
// ---------------------------------------------------------------------------

export function ceilingTexture({ seed = 3 } = {}) {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  const rand = mulberry32(seed);

  // くすんだ白
  ctx.fillStyle = '#b8b3a8';
  ctx.fillRect(0, 0, S, S);

  // 石膏の細かい凹凸（点描）
  for (let i = 0; i < 900; i++) {
    const x = rand() * S;
    const y = rand() * S;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(90,85,75,0.14)' : 'rgba(215,210,200,0.14)';
    ctx.fillRect(x, y, 1 + rand(), 1 + rand());
  }

  // うっすら汚れ（低周波）
  addBlotches(ctx, S, S, rand, {
    count: 6, rgb: '70,62,48', alphaMin: 0.04, alphaMax: 0.1,
    rMin: 20, rMax: 60, wrap: true,
  });
  addBlotches(ctx, S, S, rand, {
    count: 3, rgb: '120,100,60', alphaMin: 0.05, alphaMax: 0.09,
    rMin: 25, rMax: 55, wrap: true,
  });

  addPixelNoise(ctx, S, S, rand, 7);
  return toTexture(canvas, { tile: true });
}

// ---------------------------------------------------------------------------
// ドア
// ---------------------------------------------------------------------------

export function doorTexture({ scratched = false, seed = 4 } = {}) {
  const W = 128;
  const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = mulberry32(seed);

  // 木の下地
  ctx.fillStyle = '#5a4028';
  ctx.fillRect(0, 0, W, H);

  // 縦の木目
  for (let i = 0; i < 26; i++) {
    const gx = rand() * W;
    const amp = 1 + rand() * 2.5;
    const phase = rand() * Math.PI * 2;
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(30,18,8,0.22)' : 'rgba(140,105,65,0.12)';
    ctx.lineWidth = 0.6 + rand() * 1.4;
    ctx.beginPath();
    for (let y = 0; y <= H; y += 6) {
      const wx = gx + Math.sin((y / H) * Math.PI * 3 + phase) * amp;
      if (y === 0) ctx.moveTo(wx, y);
      else ctx.lineTo(wx, y);
    }
    ctx.stroke();
  }

  // 縦長パネル彫り2つ（上下）
  const panels = [
    { x: 24, y: 26, w: W - 48, h: 92 },
    { x: 24, y: 140, w: W - 48, h: 92 },
  ];
  for (const p of panels) {
    // 彫りの影（外周）：上・左は暗く、下・右は明るく（上からの光を想定）
    ctx.fillStyle = 'rgba(15,8,3,0.55)';
    ctx.fillRect(p.x, p.y, p.w, 3);
    ctx.fillRect(p.x, p.y, 3, p.h);
    ctx.fillStyle = 'rgba(190,150,100,0.28)';
    ctx.fillRect(p.x, p.y + p.h - 3, p.w, 3);
    ctx.fillRect(p.x + p.w - 3, p.y, 3, p.h);
    // 内側は少しだけ暗いパネル面
    ctx.fillStyle = 'rgba(20,12,6,0.16)';
    ctx.fillRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
    // パネル面中央のわずかな盛り上がり
    ctx.fillStyle = 'rgba(150,115,75,0.1)';
    ctx.fillRect(p.x + 9, p.y + 9, p.w - 18, p.h - 18);
  }

  // 経年ムラ
  addBlotches(ctx, W, H, rand, {
    count: 8, rgb: '20,12,5', alphaMin: 0.06, alphaMax: 0.16,
    rMin: 20, rMax: 70,
  });
  addBlotches(ctx, W, H, rand, {
    count: 5, rgb: '170,135,90', alphaMin: 0.04, alphaMax: 0.09,
    rMin: 25, rMax: 60,
  });

  // ドア下部の擦れ汚れ
  const g = ctx.createLinearGradient(0, H - 40, 0, H);
  g.addColorStop(0, 'rgba(10,6,3,0)');
  g.addColorStop(1, 'rgba(10,6,3,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H - 40, W, 40);

  // 引っかき傷
  if (scratched) {
    for (let i = 0; i < 14; i++) {
      const x = 10 + rand() * (W - 20);
      const y = 30 + rand() * (H - 80);
      const len = 12 + rand() * 45;
      const ang = -Math.PI / 2 + (rand() - 0.5) * 1.2;
      ctx.strokeStyle = `rgba(200,170,130,${0.25 + rand() * 0.35})`;
      ctx.lineWidth = 0.6 + rand() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      // 途中でわずかに折れる線
      const mx = x + Math.cos(ang) * len * 0.5 + (rand() - 0.5) * 3;
      const my = y + Math.sin(ang) * len * 0.5;
      ctx.lineTo(mx, my);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
  }

  addPixelNoise(ctx, W, H, rand, 8);
  return toTexture(canvas);
}

// ---------------------------------------------------------------------------
// 額縁写真
// ---------------------------------------------------------------------------

// 集合写真の共通構図を描く。頭の位置一覧を返す（smearedで使う）
function drawFamilyBase(ctx, x0, y0, w, h, rand) {
  // 背景：色褪せたセピアの室内
  const bg = ctx.createLinearGradient(0, y0, 0, y0 + h);
  bg.addColorStop(0, '#9a8a70');
  bg.addColorStop(1, '#6e6250');
  ctx.fillStyle = bg;
  ctx.fillRect(x0, y0, w, h);
  // 床のライン
  ctx.fillStyle = 'rgba(50,42,32,0.5)';
  ctx.fillRect(x0, y0 + h * 0.78, w, h * 0.22);

  // 人影のシルエット（4〜6人）
  const n = 4 + Math.floor(rand() * 3);
  const heads = [];
  for (let i = 0; i < n; i++) {
    const px = x0 + w * ((i + 0.5) / n) + (rand() - 0.5) * w * 0.05;
    const scale = 0.8 + rand() * 0.35;
    const headR = w * 0.045 * scale;
    const headY = y0 + h * (0.42 - scale * 0.1) + rand() * h * 0.04;
    const tone = 25 + rand() * 20;
    ctx.fillStyle = `rgb(${tone},${tone * 0.85},${tone * 0.7})`;
    // 胴体
    ctx.beginPath();
    ctx.ellipse(px, headY + headR * 3.6, headR * 1.9, headR * 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(px - headR * 1.5, headY + headR * 3, headR * 3, y0 + h * 0.82 - headY - headR * 3);
    // 頭
    ctx.beginPath();
    ctx.arc(px, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    // 顔のかすかな明るみ（判別できない程度）
    ctx.fillStyle = `rgba(${tone + 70},${tone + 55},${tone + 40},0.4)`;
    ctx.beginPath();
    ctx.arc(px, headY + headR * 0.15, headR * 0.7, 0, Math.PI * 2);
    ctx.fill();
    heads.push({ x: px, y: headY, r: headR });
  }
  return heads;
}

// 写真部分に周辺減光を掛ける
function vignette(ctx, x0, y0, w, h, strength) {
  const g = ctx.createRadialGradient(
    x0 + w / 2, y0 + h / 2, Math.min(w, h) * 0.3,
    x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.75
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(10,8,5,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, h);
}

export function pictureTexture(variant, { seed = 5 } = {}) {
  const W = 160;
  const H = 192;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = mulberry32(seed);

  // 額縁の木枠
  const frame = 14;
  ctx.fillStyle = '#4a3520';
  ctx.fillRect(0, 0, W, H);
  // 枠のベベル（外側明・内側暗）
  ctx.fillStyle = 'rgba(180,140,90,0.35)';
  ctx.fillRect(0, 0, W, 3);
  ctx.fillRect(0, 0, 3, H);
  ctx.fillStyle = 'rgba(10,6,3,0.5)';
  ctx.fillRect(0, H - 3, W, 3);
  ctx.fillRect(W - 3, 0, 3, H);
  ctx.fillStyle = 'rgba(10,6,3,0.6)';
  ctx.fillRect(frame - 3, frame - 3, W - (frame - 3) * 2, H - (frame - 3) * 2);
  // 枠の木目風の点々
  for (let i = 0; i < 90; i++) {
    const x = rand() * W;
    const y = rand() * H;
    if (x > frame && x < W - frame && y > frame && y < H - frame) continue;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(25,15,7,0.3)' : 'rgba(150,115,70,0.2)';
    ctx.fillRect(x, y, 1 + rand() * 2, 1);
  }

  // 写真領域
  const px = frame;
  const py = frame;
  const pw = W - frame * 2;
  const ph = H - frame * 2;

  if (variant === 'family' || variant === 'smeared') {
    const heads = drawFamilyBase(ctx, px, py, pw, ph, rand);
    if (variant === 'smeared') {
      // 顔の位置だけ横に擦って歪ませる
      for (const hd of heads) {
        const sx = Math.max(px, hd.x - hd.r * 2);
        const sy = Math.max(py, hd.y - hd.r * 2);
        const sw = hd.r * 4;
        const sh = hd.r * 4;
        for (let k = 0; k < 10; k++) {
          const dx = (rand() - 0.5) * hd.r * 3;
          const dy = (rand() - 0.5) * hd.r * 1.2;
          ctx.globalAlpha = 0.35;
          ctx.drawImage(canvas, sx, sy, sw, sh, sx + dx, sy + dy, sw, sh);
        }
        ctx.globalAlpha = 1;
        // 擦り跡の濁り
        const g = ctx.createRadialGradient(hd.x, hd.y, 0, hd.x, hd.y, hd.r * 2.2);
        g.addColorStop(0, 'rgba(60,50,40,0.45)');
        g.addColorStop(1, 'rgba(60,50,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(hd.x - hd.r * 2.2, hd.y - hd.r * 2.2, hd.r * 4.4, hd.r * 4.4);
      }
    }
    vignette(ctx, px, py, pw, ph, 0.5);
  } else if (variant === 'landscape') {
    // 空（セピア寄り）
    const sky = ctx.createLinearGradient(0, py, 0, py + ph * 0.6);
    sky.addColorStop(0, '#b3a184');
    sky.addColorStop(1, '#8d7d64');
    ctx.fillStyle = sky;
    ctx.fillRect(px, py, pw, ph * 0.6);
    // 薄い太陽
    ctx.fillStyle = 'rgba(220,205,175,0.5)';
    ctx.beginPath();
    ctx.arc(px + pw * 0.7, py + ph * 0.18, pw * 0.08, 0, Math.PI * 2);
    ctx.fill();
    // 山並み（奥と手前）
    ctx.fillStyle = '#5f5644';
    ctx.beginPath();
    ctx.moveTo(px, py + ph * 0.6);
    ctx.lineTo(px + pw * 0.3, py + ph * 0.3);
    ctx.lineTo(px + pw * 0.55, py + ph * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a4234';
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.35, py + ph * 0.6);
    ctx.lineTo(px + pw * 0.72, py + ph * 0.24);
    ctx.lineTo(px + pw, py + ph * 0.6);
    ctx.lineTo(px + pw, py + ph * 0.6);
    ctx.closePath();
    ctx.fill();
    // 手前の野原
    ctx.fillStyle = '#6b5f46';
    ctx.fillRect(px, py + ph * 0.6, pw, ph * 0.4);
    // 色褪せのオーバーレイ
    ctx.fillStyle = 'rgba(200,185,155,0.22)';
    ctx.fillRect(px, py, pw, ph);
    vignette(ctx, px, py, pw, ph, 0.45);
  } else if (variant === 'eyes') {
    // ほぼ黒つぶれ
    ctx.fillStyle = '#0a0908';
    ctx.fillRect(px, py, pw, ph);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.translate(px, py);
    addBlotches(ctx, pw, ph, rand, {
      count: 6, rgb: '30,26,22', alphaMin: 0.1, alphaMax: 0.25,
      rMin: 15, rMax: 50,
    });
    ctx.restore();
    // かすかな白い点2つ（目のように）
    const ex = px + pw * 0.44;
    const ey = py + ph * 0.38;
    const gap = pw * 0.12;
    for (const dx of [0, gap]) {
      const g = ctx.createRadialGradient(ex + dx, ey, 0, ex + dx, ey, 4);
      g.addColorStop(0, 'rgba(215,210,200,0.8)');
      g.addColorStop(0.4, 'rgba(180,175,165,0.3)');
      g.addColorStop(1, 'rgba(180,175,165,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ex + dx - 4, ey - 4, 8, 8);
    }
  } else if (variant === 'black') {
    // 完全に黒ずんだ写真
    ctx.fillStyle = '#080706';
    ctx.fillRect(px, py, pw, ph);
    // うっすら何かの輪郭（人型らしきもの）
    ctx.strokeStyle = 'rgba(28,24,20,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px + pw * 0.5, py + ph * 0.34, pw * 0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.36, py + ph * 0.8);
    ctx.quadraticCurveTo(px + pw * 0.5, py + ph * 0.42, px + pw * 0.64, py + ph * 0.8);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.translate(px, py);
    addBlotches(ctx, pw, ph, rand, {
      count: 5, rgb: '20,17,14', alphaMin: 0.2, alphaMax: 0.4,
      rMin: 15, rMax: 45,
    });
    ctx.restore();
  } else {
    // 不明なvariantは色褪せた無地（フェイルセーフ）
    ctx.fillStyle = '#8d8270';
    ctx.fillRect(px, py, pw, ph);
    vignette(ctx, px, py, pw, ph, 0.4);
  }

  // 写真全体に粗い粒子
  const img = ctx.getImageData(px, py, pw, ph);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 30;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, px, py);

  return toTexture(canvas);
}

// ---------------------------------------------------------------------------
// 壁の手書き文字
// ---------------------------------------------------------------------------

export function wallWritingTexture(text, { seed = 6 } = {}) {
  const W = 256;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = mulberry32(seed);
  // 背景は透明のまま

  const chars = Array.from(text);
  const n = Math.max(chars.length, 1);
  const baseSize = Math.min(64, (W - 30) / n);
  const baseY = H * 0.55;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let cx = W / 2 - (baseSize * (n - 1)) / 2;
  for (const ch of chars) {
    const size = baseSize * (0.8 + rand() * 0.45);
    const x = cx + (rand() - 0.5) * baseSize * 0.2;
    const y = baseY + (rand() - 0.5) * baseSize * 0.5;
    const rot = (rand() - 0.5) * 0.45;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.font = `bold ${size}px serif`;

    // 震えた筆跡：わずかにずらして数回重ね書き
    for (let k = 0; k < 4; k++) {
      const jx = (rand() - 0.5) * 2.5;
      const jy = (rand() - 0.5) * 2.5;
      const a = 0.3 + rand() * 0.35;
      const red = 90 + Math.floor(rand() * 40);
      ctx.fillStyle = `rgba(${red},${12 + Math.floor(rand() * 12)},${10 + Math.floor(rand() * 10)},${a})`;
      ctx.fillText(ch, jx, jy);
    }

    // 垂れ（文字の下から数本）
    if (rand() > 0.35) {
      const drips = 1 + Math.floor(rand() * 2);
      for (let dIdx = 0; dIdx < drips; dIdx++) {
        const dx = (rand() - 0.5) * size * 0.6;
        const dy = size * 0.35;
        const len = size * (0.3 + rand() * 0.9);
        const wDrip = 1 + rand() * 2;
        const g = ctx.createLinearGradient(0, dy, 0, dy + len);
        g.addColorStop(0, 'rgba(100,15,12,0.55)');
        g.addColorStop(1, 'rgba(100,15,12,0)');
        ctx.fillStyle = g;
        ctx.fillRect(dx - wDrip / 2, dy, wDrip, len);
        // 垂れの先の玉
        ctx.fillStyle = 'rgba(100,15,12,0.3)';
        ctx.beginPath();
        ctx.arc(dx, dy + len * 0.85, wDrip * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    cx += baseSize;
  }

  // かすれ：小さな穴をランダムに抜く
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 350; i++) {
    const x = rand() * W;
    const y = rand() * H;
    ctx.fillStyle = `rgba(0,0,0,${0.2 + rand() * 0.5})`;
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  return toTexture(canvas);
}

// ---------------------------------------------------------------------------
// 汎用ノイズ
// ---------------------------------------------------------------------------

export function noiseTexture({ seed = 7 } = {}) {
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);
  const rand = mulberry32(seed);

  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 90 + Math.floor(rand() * 90);
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // 低周波のシミっぽい濃淡も少し混ぜる
  addBlotches(ctx, S, S, rand, {
    count: 8, rgb: '40,40,40', alphaMin: 0.08, alphaMax: 0.2,
    rMin: 15, rMax: 50, wrap: true,
  });
  addBlotches(ctx, S, S, rand, {
    count: 6, rgb: '200,200,200', alphaMin: 0.06, alphaMax: 0.15,
    rMin: 15, rMax: 45, wrap: true,
  });

  return toTexture(canvas, { tile: true });
}
