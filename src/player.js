import * as THREE from 'three';

// 一人称プレイヤー: ポインタロック視点 + WASD + ヘッドボブ + 廊下内クランプ衝突

export const EYE_HEIGHT = 1.55;

// 歩行可能領域（壁から0.3mマージン）。L字 = 2つの矩形の合併
const WALK_RECTS = [
  { x1: -0.7, x2: 0.7, z1: -13.7, z2: 0.62 },   // 廊下A（南北）
  { x1: -0.7, x2: 8.72, z1: -13.7, z2: -12.3 }, // 廊下B（東西）
];

// ループドアが開いているときだけ通れる、ドアの先の通路（複製廊下の入口）
const DOOR_RECT = { x1: 8.6, x2: 10.6, z1: -13.36, z2: -12.64 };

// 浴室が全開のアノマリー中だけ入れる領域（戸口＋室内）
const BATH_RECTS = [
  { x1: 4.68, x2: 5.32, z1: -14.4, z2: -13.55 },
  { x1: 4.45, x2: 5.55, z1: -15.45, z2: -14.1 },
];

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;
    this.enabled = false;

    this.yaw = 0;      // 0 = -Z方向
    this.pitch = 0;
    this.pos = new THREE.Vector3(0, EYE_HEIGHT, 0.3);

    this.speed = 1.5;          // 歩行速度 m/s（重く、遅く）
    this.bobPhase = 0;
    this.bobAmount = 0.028;
    this.moveSmooth = new THREE.Vector2(0, 0); // 加減速のなめらかさ

    this.onFootstep = null;
    this.loopOpen = false; // ループドアが開いている（先へ歩ける）
    this.bathOpen = false; // 浴室に入れる

    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      const s = 0.0021;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      const lim = Math.PI / 2 - 0.08;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });

    // タッチ操作: 画面左半分=移動スティック、右半分=視点ドラッグ
    this.touchStick = null; // {id, sx, sy, x, y}
    this.touchLook = null;  // {id, x, y}
    domElement.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.45 && !this.touchStick) {
          this.touchStick = { id: t.identifier, sx: t.clientX, sy: t.clientY, x: t.clientX, y: t.clientY };
        } else if (!this.touchLook) {
          this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });
    domElement.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (this.touchStick && t.identifier === this.touchStick.id) {
          this.touchStick.x = t.clientX;
          this.touchStick.y = t.clientY;
        } else if (this.touchLook && t.identifier === this.touchLook.id) {
          const s = 0.0045;
          this.yaw -= (t.clientX - this.touchLook.x) * s;
          this.pitch -= (t.clientY - this.touchLook.y) * s;
          const lim = Math.PI / 2 - 0.08;
          this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
          this.touchLook.x = t.clientX;
          this.touchLook.y = t.clientY;
        }
      }
    }, { passive: false });
    const endTouch = (e) => {
      for (const t of e.changedTouches) {
        if (this.touchStick && t.identifier === this.touchStick.id) this.touchStick = null;
        if (this.touchLook && t.identifier === this.touchLook.id) this.touchLook = null;
      }
    };
    domElement.addEventListener('touchend', endTouch);
    domElement.addEventListener('touchcancel', endTouch);

    this.camera.rotation.order = 'YXZ';
    this._sync();
  }

  enable() { this.enabled = true; }
  disable() { this.enabled = false; this.keys.clear(); }

  teleport(x, z, yaw) {
    this.pos.set(x, EYE_HEIGHT, z);
    this.yaw = yaw;
    this._sync();
  }

  _inside(x, z) {
    const hit = (r) => x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
    if (WALK_RECTS.some(hit)) return true;
    if (this.loopOpen && hit(DOOR_RECT)) return true;
    return this.bathOpen && BATH_RECTS.some(hit);
  }

  get position() { return this.pos; }

  update(dt) {
    let ix = 0, iz = 0;
    if (this.enabled) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    }
    // タッチスティックの入力を合成
    if (this.enabled && this.touchStick) {
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      ix += clamp((this.touchStick.x - this.touchStick.sx) / 55);
      iz += clamp((this.touchStick.y - this.touchStick.sy) / 55);
    }

    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }

    // 加減速をなめらかに
    const k = 1 - Math.exp(-10 * dt);
    this.moveSmooth.x += (ix - this.moveSmooth.x) * k;
    this.moveSmooth.y += (iz - this.moveSmooth.y) * k;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // カメラ基準の移動方向をワールドへ（forward=(-sin,0,-cos), right=(cos,0,-sin)）
    const dx = (this.moveSmooth.x * cos + this.moveSmooth.y * sin) * this.speed * dt;
    const dz = (-this.moveSmooth.x * sin + this.moveSmooth.y * cos) * this.speed * dt;

    // 軸ごとに衝突判定（壁ずり）
    if (this._inside(this.pos.x + dx, this.pos.z)) this.pos.x += dx;
    if (this._inside(this.pos.x, this.pos.z + dz)) this.pos.z += dz;

    // ヘッドボブと足音
    const moving = this.moveSmooth.length() > 0.25;
    if (moving) {
      const prev = this.bobPhase;
      this.bobPhase += dt * 5.6 * this.moveSmooth.length();
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        if (this.onFootstep) this.onFootstep();
      }
    } else {
      this.bobPhase *= 1 - Math.min(1, 4 * dt);
    }
    this._sync();
  }

  _sync() {
    const bobY = Math.sin(this.bobPhase) * this.bobAmount * this.moveSmooth.length();
    const bobX = Math.cos(this.bobPhase * 0.5) * this.bobAmount * 0.5 * this.moveSmooth.length();
    this.camera.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + bobY, this.pos.z + bobX * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
