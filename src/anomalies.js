import * as THREE from 'three';

// アノマリープール制のループ管理
//
// 構成: L0=平常 → tier1×3 → tier2×3 → tier3×2（各tier内でランダム抽選・順序も
// ランダム）→ 最終ループ（すべて元に戻った静寂、玄関から脱出）の全10ループ。
// 各アノマリーは apply() で廊下を変え、key の凝視で「認識」すると先へ進める。
// 恐怖の底流（ドローン・ノイズ・暗さ・環境音の頻度）はループ番号に応じて深まる。

const WRITINGS = ['でていけ', 'みるな', 'うしろにいる', 'かえれない'];

// key: (corridor) => [凝視対象Object3D, 最大距離, 必要秒数]
// testView: 自動テスト用の視点（p:立ち位置 t:注視点）
const POOL = [
  // --- tier1: 軽い違和感 ---
  {
    id: 'radio', tier: 1,
    key: (c) => [c.radio.group, 3.5, 1.6],
    testView: { p: [0.2, -6.4], t: [-0.72, 0.84, -7] },
    apply({ corridor: c, audio: a }) {
      c.radio.setOn(true);
      a.setRadio(true, -0.4);
    },
  },
  {
    id: 'frame-smeared', tier: 1,
    key: (c) => [c.frames[1].group, 3.2, 1.6],
    testView: { p: [0.1, -6.0], t: [0.975, 1.55, -6] },
    apply({ corridor: c }) {
      c.frames[1].setVariant('smeared');
      c.frames[1].setCrooked(true);
    },
  },
  {
    id: 'frames-flipped', tier: 1,
    key: (c) => [c.frames[3].group, 3.2, 1.6],
    testView: { p: [0.3, -4.5], t: [-0.975, 1.55, -4.5] },
    apply({ corridor: c }) {
      for (const f of c.frames) f.setFlipped(true);
    },
  },
  {
    id: 'lamp-color', tier: 1,
    key: (c) => [c.lamps[1].group, 5, 1.6],
    testView: { p: [0, -6.5], t: [0, 2.05, -8] },
    apply({ corridor: c }) {
      for (const l of c.lamps) l.setColor(0x9fe8c0); // 病的な青緑
    },
  },
  {
    id: 'table-moved', tier: 1,
    key: (c) => [c.radio.group, 3.5, 1.6],
    testView: { p: [-0.3, -5.8], t: [0.25, 0.8, -7.2] },
    apply({ corridor: c }) {
      c.radio.setMoved(true);
    },
  },
  // --- tier2: 明確な異常 ---
  {
    id: 'bathroom-ajar', tier: 2,
    key: (c) => [c.bathroomDoor.group, 4.5, 2.0],
    testView: { p: [5.0, -13.0], t: [5.0, 1.0, -13.9] },
    apply({ corridor: c, audio: a }) {
      c.bathroomDoor.setOpen(0.3);
      a.setBreathing(true, 0.3);
    },
  },
  {
    id: 'bathroom-open', tier: 2, enterBath: true,
    key: (c) => [c.bath.mirror, 3.0, 1.8],
    testView: { p: [5.0, -14.6], t: [5.0, 1.45, -15.75] },
    apply({ corridor: c, audio: a }) {
      c.bathroomDoor.setOpen(0.92); // 全開。中に入れる
      c.bath.light.intensity = 6;
      a.setBreathing(true, 0.2);
    },
  },
  {
    id: 'strange-door', tier: 2,
    key: (c) => [c.westDoor.group, 3.5, 1.8],
    testView: { p: [0.3, -5.8], t: [-0.97, 1.1, -5.8] },
    apply({ corridor: c }) {
      c.westDoor.group.visible = true; // あるはずのないドア
    },
  },
  {
    id: 'eyes', tier: 2,
    key: (c) => [c.frames[2].group, 3.2, 1.6],
    testView: { p: [0.1, -9.0], t: [0.975, 1.55, -9] },
    apply({ corridor: c, audio: a }) {
      c.frames[2].setVariant('eyes');
      a.setHeartbeat(46);
    },
  },
  {
    id: 'scratched-entry', tier: 2,
    key: (c) => [c.entryDoor.group, 3.5, 1.8],
    testView: { p: [0, -1.5], t: [0, 1.1, 0.97] },
    apply({ corridor: c }) {
      c.entryDoor.setScratched(true);
    },
  },
  // --- tier3: 重い恐怖 ---
  {
    id: 'figure', tier: 3, figure: true,
    key: (c) => [c.figure.group, 13, 1.2],
    testView: { p: [1.0, -13.0], t: [8.3, 1.2, -13.68] },
    apply({ corridor: c, audio: a }) {
      for (const l of c.lamps) l.setOn(false);
      c.lamps[2].setOn(true);
      c.lamps[2].setSwing(true);
      c.lamps[3].setOn(true);
      c.lamps[3].setFlicker(true);
      c.figure.setVisible(true);
      a.setHeartbeat(60);
    },
  },
  {
    id: 'writing', tier: 3,
    key: (c) => [c.writing.mesh, 4.5, 1.8],
    testView: { p: [0, -7.5], t: [0.98, 1.5, -7.5] },
    apply({ corridor: c, audio: a }) {
      c.writing.show(WRITINGS[Math.floor(Math.random() * WRITINGS.length)]);
      c.lamps[0].setFlicker(true);
      a.setHeartbeat(50);
    },
  },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BATH_LIGHT_BASE = 3.4;

export class LoopManager {
  constructor({ corridor, audio, post, ui }) {
    this.corridor = corridor;
    this.audio = audio;
    this.post = post;
    this.ui = ui;

    // プレイごとにアノマリーを抽選（tierが進むごとに重くなる）
    const t1 = shuffle(POOL.filter((a) => a.tier === 1)).slice(0, 3);
    const t2 = shuffle(POOL.filter((a) => a.tier === 2)).slice(0, 3);
    const t3 = shuffle(POOL.filter((a) => a.tier === 3)).slice(0, 2);
    this.sequence = [null, ...t1, ...t2, ...t3, 'final'];

    this.index = 0;
    this.recognized = true;
    this.keyObject = null;
    this.keyDist = 0;
    this.keyNeeded = 1;
    this.gaze = 0;
    this.failCount = 0;

    this.raycaster = new THREE.Raycaster();
    this._events = {};
    this._eventTimers = {};
    this._pendingTimeouts = [];

    this.pool = POOL; // デバッグ・テスト用
  }

  get current() {
    const s = this.sequence[this.index];
    return s && s !== 'final' ? s : null;
  }

  get isFinal() { return this.sequence[this.index] === 'final'; }

  // 浴室に入れるアノマリー中か（プレイヤー衝突の拡張に使う）
  get bathEnterable() { return !!this.current?.enterBath; }

  applyLoop(i) {
    this.index = Math.min(i, this.sequence.length - 1);
    const c = this.corridor;
    const a = this.audio;

    for (const t of this._pendingTimeouts) clearTimeout(t);
    this._pendingTimeouts = [];

    // --- いったんすべて平常に戻す ---
    c.radio.setOn(false); c.radio.setMoved(false); a.setRadio(false);
    a.setBreathing(false);
    c.bathroomDoor.setOpen(0);
    c.bath.light.intensity = BATH_LIGHT_BASE;
    for (const f of c.frames) {
      f.setVariant(f.baseVariant);
      f.setCrooked(false);
      f.setFlipped(false);
    }
    c.writing.hide();
    c.figure.setVisible(false);
    c.westDoor.group.visible = false;
    for (const l of c.lamps) {
      l.setFlicker(false); l.setSwing(false); l.setColor(null); l.setOn(true);
    }
    c.entryDoor.setOpen(0); c.entryDoor.setScratched(false);
    c.exitLight.intensity = 0;
    a.setHeartbeat(0);
    a.setHum(true);

    // --- ループ番号に応じて恐怖の底流を深める ---
    const n = this.index;
    a.setDrone(this.isFinal ? 0.03 : Math.min(0.85, 0.08 + n * 0.085));
    this.post.setBaseNoise(this.isFinal ? 0.03 : Math.min(0.34, 0.04 + n * 0.033));
    this.post.setDarkness(this.isFinal ? 0.1 : Math.min(0.5, 0.05 + n * 0.05));

    this._events = {};
    if (!this.isFinal) {
      this._events.creak = Math.max(8, 24 - n * 2);
      if (n >= 1) this._events.thud = Math.max(9, 26 - n * 2);
      if (n >= 4) this._events.whisper = Math.max(7, 30 - n * 3);
    }
    this._eventTimers = {};
    for (const [name, mean] of Object.entries(this._events)) {
      this._eventTimers[name] = mean * (0.4 + Math.random() * 0.8);
    }

    // --- このループのアノマリーを適用 ---
    const cur = this.current;
    if (cur) {
      cur.apply({ corridor: c, audio: a, post: this.post });
      const [obj, dist, needed] = cur.key(c);
      this.keyObject = obj;
      this.keyDist = dist;
      this.keyNeeded = needed;
      this.recognized = false;
    } else {
      this.keyObject = null;
      this.recognized = true;
    }

    if (this.isFinal) {
      c.entryDoor.setOpen(0.4);
      c.exitLight.intensity = 26;
    }

    this.gaze = 0;
    this.failCount = 0;
  }

  // ループドアを通過した。進めたらtrue
  onDoorPass() {
    if (this.recognized) {
      this.applyLoop(this.index + 1);
      return true;
    }
    this.failCount += 1;
    if (this.failCount >= 2) {
      this.ui.showHint('どこかが　おかしい', 3);
    }
    return false;
  }

  _onRecognized() {
    this.recognized = true;
    const a = this.audio;
    a.stinger('recognize');
    a.whisper((Math.random() - 0.5) * 1.2);
    this.post.pulse(0.55);

    // 人影の特殊演出: 認識した瞬間、全照明が落ちて人影が消える
    if (this.current?.figure) {
      const c = this.corridor;
      a.stinger('dark');
      for (const l of c.lamps) l.setOn(false);
      this.post.pulse(0.9);
      this._pendingTimeouts.push(setTimeout(() => {
        c.figure.setVisible(false);
        c.lamps[2].setOn(true);
      }, 1400));
    }
  }

  update(dt, camera) {
    // --- 凝視判定 ---
    if (this.keyObject && !this.recognized) {
      this.raycaster.setFromCamera({ x: 0, y: 0 }, camera);
      this.raycaster.far = this.keyDist;
      const hits = this.raycaster.intersectObject(this.keyObject, true);
      if (hits.length > 0) {
        this.gaze += dt / this.keyNeeded;
        if (this.gaze >= 1) {
          this.gaze = 0;
          this._onRecognized();
        }
      } else {
        this.gaze = Math.max(0, this.gaze - dt * 0.8);
      }
      this.ui.setGazeProgress(this.gaze);
    } else {
      this.ui.setGazeProgress(0);
    }

    // --- 環境音イベント ---
    for (const [name, mean] of Object.entries(this._events)) {
      this._eventTimers[name] -= dt;
      if (this._eventTimers[name] <= 0) {
        this._eventTimers[name] = mean * (0.5 + Math.random());
        const pan = (Math.random() - 0.5) * 1.4;
        if (name === 'whisper') this.audio.whisper(pan);
        else if (name === 'thud') this.audio.thud();
        else if (name === 'creak') this.audio.creak();
      }
    }
  }
}
