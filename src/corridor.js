import * as THREE from 'three';
import {
  wallpaperTexture, floorTexture, ceilingTexture, doorTexture,
  pictureTexture, wallWritingTexture,
} from './textures.js';

// L字廊下の構築。座標系:
//   廊下A: x∈[-1,1], z∈[-14,1]（スタートはz≈0.3、-Z方向へ歩く）
//   廊下B: z∈[-14,-12], x∈[-1,9]（角を右に曲がって+X方向、突き当たりがループドア）

const H = 2.6; // 天井高

function makeTiled(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

function wallMesh(w, tex, rx) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, H),
    new THREE.MeshLambertMaterial({ map: makeTiled(tex, rx, 1) }),
  );
  return m;
}

// ドア: ヒンジ付きグループ。openTargetへ毎フレームなめらかに回転
// dir: 開く向き（1=手前側/-1=奥側）
function makeDoor({ scratched = false, dir = 1 } = {}) {
  const hinge = new THREE.Group();
  const panelMat = new THREE.MeshLambertMaterial({ map: doorTexture({ scratched }) });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.88, 2.08, 0.05), panelMat);
  panel.position.set(0.44, 1.04, 0); // ヒンジは左端
  hinge.add(panel);

  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2e2119 });
  const frame = new THREE.Group();
  for (const [x, y, w, h] of [
    [-0.49, 1.09, 0.08, 2.26],
    [0.49, 1.09, 0.08, 2.26],
    [0, 2.19, 1.06, 0.1],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.09), frameMat);
    bar.position.set(x, y, 0);
    frame.add(bar);
  }

  // ドアの奥の闇
  const dark = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 2.3),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  dark.position.set(0, 1.12, -0.12);

  const group = new THREE.Group();
  hinge.position.set(-0.44, 0, 0);
  group.add(dark, hinge, frame);

  const door = {
    group, panel, hinge, dark,
    angle: 0, openTarget: 0,
    setOpen(t) { this.openTarget = t; }, // 0=閉 1=全開（奥へ）
    setScratched(v) {
      panel.material.map = doorTexture({ scratched: v });
      panel.material.needsUpdate = true;
    },
    update(dt) {
      const k = 1 - Math.exp(-2.2 * dt);
      this.angle += (this.openTarget * -1.9 * dir - this.angle) * k;
      hinge.rotation.y = this.angle;
    },
  };
  return door;
}

// 額縁
function makeFrame(initialVariant) {
  const cache = new Map();
  const getTex = (v) => {
    if (!cache.has(v)) cache.set(v, pictureTexture(v));
    return cache.get(v);
  };
  const group = new THREE.Group();
  const border = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.64, 0.035),
    new THREE.MeshLambertMaterial({ color: 0x241a12 }),
  );
  const pic = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.56),
    new THREE.MeshLambertMaterial({ map: getTex(initialVariant) }),
  );
  pic.position.z = 0.02;
  group.add(border, pic);
  const state = { crook: false, flip: false };
  const applyRot = () => {
    group.rotation.z = state.flip ? Math.PI : (state.crook ? 0.14 : 0);
  };
  return {
    group, pic,
    setVariant(v) {
      pic.material.map = getTex(v);
      pic.material.needsUpdate = true;
    },
    setCrooked(on) { state.crook = on; applyRot(); },
    setFlipped(on) { state.flip = on; applyRot(); },
  };
}

// 吊り下げランプ
function makeLamp(x, z) {
  const group = new THREE.Group(); // 天井のピボット
  group.position.set(x, H, z);

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x111111 }),
  );
  cord.position.y = -0.25;
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.17, 0.15, 10, 1, true),
    new THREE.MeshLambertMaterial({ color: 0x39352c, side: THREE.DoubleSide }),
  );
  shade.position.y = -0.53;
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  );
  bulb.position.y = -0.58;
  const light = new THREE.PointLight(0xffc98a, 14, 10, 1.8);
  light.position.y = -0.62;
  group.add(cord, shade, bulb, light);

  return {
    group, light, bulb,
    baseIntensity: 14,
    on: true, flicker: false, swing: false,
    _bulbColor: 0xffd9a0,
    _seed: Math.abs(x * 7.13 + z * 3.71),
    setOn(v) {
      this.on = v;
      bulb.material.color.setHex(v ? this._bulbColor : 0x141210);
      light.intensity = v ? this.baseIntensity : 0;
    },
    // hex=null で通常の暖色に戻る
    setColor(hex) {
      this._bulbColor = hex ?? 0xffd9a0;
      light.color.setHex(hex ?? 0xffc98a);
      if (this.on) bulb.material.color.setHex(this._bulbColor);
    },
    setFlicker(v) { this.flicker = v; if (!v) this.setOn(this.on); },
    setSwing(v) { this.swing = v; if (!v) group.rotation.set(0, 0, 0); },
    update(dt, time) {
      if (this.swing) {
        group.rotation.z = Math.sin(time * 1.15 + this._seed) * 0.25;
        group.rotation.x = Math.sin(time * 0.9 + this._seed * 2) * 0.1;
      }
      if (this.on && this.flicker) {
        // 不規則な明滅
        const n = Math.sin(time * 31 + this._seed) * Math.sin(time * 7.3 + this._seed * 5) +
                  Math.sin(time * 53 + this._seed * 9) * 0.5;
        const drop = n > 1.05 ? 0.08 : 1.0;
        const jitter = 0.9 + 0.1 * Math.sin(time * 87 + this._seed);
        light.intensity = this.baseIntensity * drop * jitter;
        bulb.material.color.setHex(drop < 0.5 ? 0x2a241c : this._bulbColor);
      }
    },
  };
}

// サイドテーブルと古いラジオ
function makeTableRadio() {
  const group = new THREE.Group();
  const tableMat = new THREE.MeshLambertMaterial({ color: 0x2b2019 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.32), tableMat);
  top.position.y = 0.74;
  group.add(top);
  for (const [lx, lz] of [[-0.22, -0.12], [0.22, -0.12], [-0.22, 0.12], [0.22, 0.12]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.74, 0.035), tableMat);
    leg.position.set(lx, 0.37, lz);
    group.add(leg);
  }

  const radioGroup = new THREE.Group();
  const radioBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.15, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x3a2418 }),
  );
  radioBody.position.y = 0.835;
  const grille = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.1),
    new THREE.MeshLambertMaterial({ color: 0x14100c }),
  );
  grille.position.set(0.055, 0.835, 0.061);
  const dial = new THREE.Mesh(
    new THREE.PlaneGeometry(0.07, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xff8830 }),
  );
  dial.position.set(-0.085, 0.85, 0.061);
  dial.visible = false;
  radioGroup.add(radioBody, grille, dial);
  radioGroup.rotation.y = 0.5; // 少し廊下側に向ける
  group.add(radioGroup);
  return { group, dial };
}

export function buildCorridor(scene) {
  const group = new THREE.Group();

  const wallTex = wallpaperTexture({ stained: 0.35 });
  const floorTex = floorTexture();
  const ceilTex = ceilingTexture();

  // 床・天井
  const floorMatA = new THREE.MeshLambertMaterial({ map: makeTiled(floorTex, 1.6, 12.5) });
  const floorA = new THREE.Mesh(new THREE.PlaneGeometry(2, 15), floorMatA);
  floorA.rotation.x = -Math.PI / 2;
  floorA.position.set(0, 0, -6.5);
  const floorMatB = new THREE.MeshLambertMaterial({ map: makeTiled(floorTex, 6.6, 1.6) });
  const floorB = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), floorMatB);
  floorB.rotation.x = -Math.PI / 2;
  floorB.position.set(5, 0, -13);

  const ceilA = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 15),
    new THREE.MeshLambertMaterial({ map: makeTiled(ceilTex, 1.4, 10) }),
  );
  ceilA.rotation.x = Math.PI / 2;
  ceilA.position.set(0, H, -6.5);
  const ceilB = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 2),
    new THREE.MeshLambertMaterial({ map: makeTiled(ceilTex, 5.4, 1.4) }),
  );
  ceilB.rotation.x = Math.PI / 2;
  ceilB.position.set(5, H, -13);
  group.add(floorA, floorB, ceilA, ceilB);

  // 壁
  const addWall = (w, x, z, ry) => {
    const m = wallMesh(w, wallTex, w / 2.2);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    group.add(m);
    return m;
  };
  // ドア用の開口部（幅0.94×高さ2.16）を持つ壁。u0は壁中心からのドア中心オフセット
  const addDoorwayWall = (w, x, z, ry, u0 = 0) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    const a = 0.47; // 開口半幅
    const addStrip = (from, to) => {
      const sw = to - from;
      if (sw <= 0.01) return;
      const m = wallMesh(sw, wallTex, sw / 2.2);
      m.position.set((from + to) / 2, H / 2, 0);
      g.add(m);
    };
    addStrip(-w / 2, u0 - a);
    addStrip(u0 + a, w / 2);
    const lintel = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * a, H - 2.16),
      new THREE.MeshLambertMaterial({ map: makeTiled(wallTex, (2 * a) / 2.2, (H - 2.16) / H) }),
    );
    lintel.position.set(u0, 2.16 + (H - 2.16) / 2, 0);
    g.add(lintel);
    group.add(g);
    return g;
  };
  addWall(15, -1, -6.5, Math.PI / 2);        // A西
  addWall(13, 1, -5.5, -Math.PI / 2);        // A東（角の開口まで）
  addDoorwayWall(2, 0, 1, Math.PI);          // 正面（玄関ドアの開口）
  addDoorwayWall(10, 4, -14, 0, 1);          // B北（浴室ドアの開口 x=5）
  addWall(8, 5, -12, Math.PI);               // B南
  addDoorwayWall(2, 9, -13, -Math.PI / 2);   // B東（ループドアの開口）

  // 幅木（壁の足元の帯）— 生活感
  const skirtMat = new THREE.MeshLambertMaterial({ color: 0x211913 });
  for (const [w, x, z, ry] of [
    [15, -0.99, -6.5, Math.PI / 2], [13, 0.99, -5.5, -Math.PI / 2],
    [10, 4, -13.99, 0], [8, 5, -12.01, Math.PI],
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.12), skirtMat);
    s.position.set(x, 0.06, z);
    s.rotation.y = ry;
    group.add(s);
  }

  // ドア3枚
  const entryDoor = makeDoor();
  entryDoor.group.position.set(0, 0, 0.97);
  entryDoor.group.rotation.y = Math.PI;

  const loopDoor = makeDoor();
  loopDoor.group.position.set(8.96, 0, -13);
  loopDoor.group.rotation.y = -Math.PI / 2;
  loopDoor.dark.visible = false; // 奥には複製廊下が見える

  const bathroomDoor = makeDoor({ dir: -1 }); // 浴室の内側へ開く
  bathroomDoor.group.position.set(5, 0, -13.96);
  bathroomDoor.dark.visible = false; // 奥には浴室の中が見える
  group.add(entryDoor.group, loopDoor.group, bathroomDoor.group);

  // --- 浴室の中（隙間から覗き込める。誰もいない） ---
  const bath = new THREE.Group();
  bath.position.set(5, 0, -14);
  let bathLight, bathMirror;
  {
    const BH = 2.3; // 浴室の天井は低い
    const tile = () => new THREE.MeshLambertMaterial({
      map: makeTiled(ceilTex, 3, 2.6), color: 0x8e989c,
    });
    const bFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.8),
      new THREE.MeshLambertMaterial({ map: makeTiled(floorTex, 1.5, 1.5), color: 0x5c6166 }),
    );
    bFloor.rotation.x = -Math.PI / 2;
    bFloor.position.set(0, 0.005, -0.9);
    const bCeil = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), tile());
    bCeil.rotation.x = Math.PI / 2;
    bCeil.position.set(0, BH, -0.9);
    const bBack = new THREE.Mesh(new THREE.PlaneGeometry(1.8, BH), tile());
    bBack.position.set(0, BH / 2, -1.79);
    const bLeft = new THREE.Mesh(new THREE.PlaneGeometry(1.8, BH), tile());
    bLeft.rotation.y = Math.PI / 2;
    bLeft.position.set(-0.89, BH / 2, -0.9);
    const bRight = new THREE.Mesh(new THREE.PlaneGeometry(1.8, BH), tile());
    bRight.rotation.y = -Math.PI / 2;
    bRight.position.set(0.89, BH / 2, -0.9);
    bath.add(bFloor, bCeil, bBack, bLeft, bRight);
    // ドア開口まわりの内側の壁
    for (const [w, x] of [[0.43, -0.685], [0.43, 0.685]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, BH), tile());
      s.rotation.y = Math.PI;
      s.position.set(x, BH / 2, -0.03);
      bath.add(s);
    }
    const bLintel = new THREE.Mesh(new THREE.PlaneGeometry(0.94, BH - 2.16), tile());
    bLintel.rotation.y = Math.PI;
    bLintel.position.set(0, 2.16 + (BH - 2.16) / 2, -0.03);
    bath.add(bLintel);

    // 洗面台と鏡
    const porcelain = new THREE.MeshLambertMaterial({ color: 0xaab0ac });
    const basin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.32), porcelain);
    basin.position.set(0, 0.74, -1.58);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), porcelain);
    pedestal.position.set(0, 0.35, -1.6);
    const mirrorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.48, 0.03),
      new THREE.MeshLambertMaterial({ color: 0x2a2622 }),
    );
    mirrorFrame.position.set(0, 1.45, -1.77);
    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x0b0e12 }), // 何も映さない暗い鏡
    );
    mirror.position.set(0, 1.45, -1.75);
    bathMirror = new THREE.Group();
    bathMirror.add(mirrorFrame, mirror);
    bath.add(basin, pedestal, bathMirror);

    // 浴槽（縁だけ白く、中は影）
    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 1.5), porcelain);
    tub.position.set(-0.55, 0.21, -1.0);
    const tubInner = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 1.38),
      new THREE.MeshLambertMaterial({ color: 0x0d1013 }),
    );
    tubInner.rotation.x = -Math.PI / 2;
    tubInner.position.set(-0.55, 0.425, -1.0);
    bath.add(tub, tubInner);

    // かすかな冷たい明かり
    bathLight = new THREE.PointLight(0x9fb4c8, 3.4, 4, 1.7);
    bathLight.position.set(0, 2.05, -0.9);
    bath.add(bathLight);
  }
  group.add(bath);

  // 額縁
  const frameDefs = [
    { pos: [0.975, 1.55, -3], ry: -Math.PI / 2, v: 'landscape' },
    { pos: [0.975, 1.55, -6], ry: -Math.PI / 2, v: 'family' },    // f1: L2で歪む
    { pos: [0.975, 1.55, -9], ry: -Math.PI / 2, v: 'landscape' }, // f2: L5で目に
    { pos: [-0.975, 1.55, -4.5], ry: Math.PI / 2, v: 'family' },
    { pos: [-0.975, 1.55, -10.5], ry: Math.PI / 2, v: 'landscape' },
    { pos: [4.5, 1.55, -12.02], ry: Math.PI, v: 'family' },
    { pos: [2.5, 1.55, -13.98], ry: 0, v: 'landscape' },
  ];
  const frames = frameDefs.map((d) => {
    const f = makeFrame(d.v);
    f.baseVariant = d.v;
    f.group.position.set(...d.pos);
    f.group.rotation.y = d.ry;
    group.add(f.group);
    return f;
  });

  // サイドテーブルとラジオ
  const { group: tableRadioGroup, dial } = makeTableRadio();
  tableRadioGroup.position.set(-0.72, 0, -7);
  const radio = {
    group: tableRadioGroup, dial,
    setOn(v) { dial.visible = v; },
    // 廊下の真ん中に移動している（アノマリー）
    setMoved(v) {
      if (v) {
        tableRadioGroup.position.set(0.25, 0, -7.2);
        tableRadioGroup.rotation.y = -0.9;
      } else {
        tableRadioGroup.position.set(-0.72, 0, -7);
        tableRadioGroup.rotation.y = 0;
      }
    },
  };
  group.add(tableRadioGroup);

  // あるはずのないドア（西壁、アノマリー時のみ出現）
  const westDoor = makeDoor({ scratched: true });
  westDoor.group.position.set(-0.97, 0, -5.8);
  westDoor.group.rotation.y = Math.PI / 2;
  westDoor.group.visible = false;
  group.add(westDoor.group);

  // ランプ
  const lamps = [
    makeLamp(0, -3.5),
    makeLamp(0, -8),
    makeLamp(0, -12.8),  // 角（L4で揺れる）
    makeLamp(5.5, -13),
  ];
  for (const l of lamps) group.add(l.group);

  // 人影（L4）— 背後の微かな冷光で逆光のシルエットにする
  const figureGroup = new THREE.Group();
  const figMat = new THREE.MeshLambertMaterial({ color: 0x08080a, emissive: 0x0a0a10 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.5, 8), figMat);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), figMat);
  head.position.set(0.02, 1.6, 0);
  head.rotation.z = 0.2;
  const backLight = new THREE.PointLight(0x8090b8, 4.5, 5, 1.6);
  backLight.position.set(0.4, 2.3, 0.1);
  figureGroup.add(body, head, backLight);
  figureGroup.position.set(8.3, 0, -13.68); // ループドアの脇、壁を背にして立つ
  figureGroup.visible = false;
  const figure = {
    group: figureGroup,
    setVisible(v) { figureGroup.visible = v; },
  };
  group.add(figureGroup);

  // 壁の文字（L5）
  const writingMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.9),
    new THREE.MeshLambertMaterial({ transparent: true, opacity: 0 }),
  );
  writingMesh.position.set(0.98, 1.5, -7.5);
  writingMesh.rotation.y = -Math.PI / 2;
  writingMesh.visible = false;
  const writing = {
    mesh: writingMesh,
    show(text) {
      writingMesh.material.map = wallWritingTexture(text);
      writingMesh.material.opacity = 1;
      writingMesh.material.needsUpdate = true;
      writingMesh.visible = true;
    },
    hide() { writingMesh.visible = false; },
  };
  group.add(writingMesh);

  // 玄関の外からの冷たい光（最終ループ）
  const exitLight = new THREE.PointLight(0xbfd4ff, 0, 7, 1.6);
  exitLight.position.set(0, 1.7, 0.55);
  group.add(exitLight);

  // --- ループドアの先: 廊下Aの複製（シームレスなループ用） ---
  // ループドアの敷居(9,-13) を玄関ドアの面(実座標 z=0.97) に対応させて回転配置する。
  // ドアの先に「次の周回の廊下」が実際に見え、少し入ったところでゲームが実座標へ写像テレポートする。
  const replica = new THREE.Group();
  replica.position.set(9, 0, -13);
  replica.rotation.y = -Math.PI / 2;
  const rep = new THREE.Group();
  rep.position.set(0, 0, -0.97);
  replica.add(rep);

  const rFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 14.97),
    new THREE.MeshLambertMaterial({ map: makeTiled(floorTex, 1.6, 12.5) }),
  );
  rFloor.rotation.x = -Math.PI / 2;
  rFloor.position.set(0, 0, -6.515);
  const rCeil = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 14.97),
    new THREE.MeshLambertMaterial({ map: makeTiled(ceilTex, 1.4, 10) }),
  );
  rCeil.rotation.x = Math.PI / 2;
  rCeil.position.set(0, H, -6.515);
  rep.add(rFloor, rCeil);

  for (const [w, x, z, ry] of [
    [14.97, -1, -6.515, Math.PI / 2],  // 西
    [12.97, 1, -5.515, -Math.PI / 2],  // 東（角の開口まで）
    [2, 0, -14, 0],                    // 突き当たり（霧の彼方）
  ]) {
    const m = wallMesh(w, wallTex, w / 2.2);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    rep.add(m);
  }
  for (const [w, x, z, ry] of [
    [14.97, -0.99, -6.515, Math.PI / 2], [12.97, 0.99, -5.515, -Math.PI / 2],
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.12), skirtMat);
    s.position.set(x, 0.06, z);
    s.rotation.y = ry;
    rep.add(s);
  }

  // 静的な小物（額縁・テーブル・ラジオ）— 遠景なので基本状態で固定
  for (const d of frameDefs.slice(0, 5)) {
    const f = makeFrame(d.v);
    f.group.position.set(...d.pos);
    f.group.rotation.y = d.ry;
    rep.add(f.group);
  }
  const repTable = makeTableRadio();
  repTable.group.position.set(-0.72, 0, -7);
  rep.add(repTable.group);

  // 複製側のランプ（実物のlamp0/lamp1/lamp2と明るさを同期）
  const repLamps = [makeLamp(0, -3.5), makeLamp(0, -8), makeLamp(0, -12.8)];
  for (const l of repLamps) rep.add(l.group);

  group.add(replica);

  scene.add(group);

  return {
    group,
    entryDoor, loopDoor, bathroomDoor, westDoor,
    frames, radio, lamps, figure, writing, exitLight,
    bath: { group: bath, light: bathLight, mirror: bathMirror },
    update(dt, time) {
      entryDoor.update(dt);
      loopDoor.update(dt);
      bathroomDoor.update(dt);
      for (const l of lamps) l.update(dt, time);
      // 複製廊下のランプを実物と同期（明滅・消灯がドア越しにも一致する）
      for (let i = 0; i < repLamps.length; i++) {
        repLamps[i].light.intensity = lamps[i].light.intensity;
        repLamps[i].bulb.material.color.copy(lamps[i].bulb.material.color);
      }
    },
  };
}
