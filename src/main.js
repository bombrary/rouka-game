import * as THREE from 'three';
import { buildCorridor } from './corridor.js';
import { Player } from './player.js';
import { AudioEngine } from './audio.js';
import { VHSPipeline } from './post.js';
import { LoopManager } from './anomalies.js';
import { UI } from './ui.js';

// --- セットアップ ---
const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020305);
scene.fog = new THREE.FogExp2(0x030407, 0.058); // ドア越しの複製廊下(15m+)が奥行きとして読める濃さ

const camera = new THREE.PerspectiveCamera(
  68, window.innerWidth / window.innerHeight, 0.05, 50,
);

scene.add(new THREE.AmbientLight(0x2a3040, 0.6));

const corridor = buildCorridor(scene);
const player = new Player(camera, renderer.domElement);
const audio = new AudioEngine();
const post = new VHSPipeline(renderer, scene, camera, { pixelScale: 4 });
const ui = new UI(document.body);
const loops = new LoopManager({ corridor, audio, post, ui });

let state = 'title'; // 'title' | 'playing' | 'paused' | 'ending'
let lockedThudCooldown = 0;

loops.applyLoop(0);

// --- 開始・ポーズ ---
// タッチデバイス（スマホ・LINE等のアプリ内ブラウザ含む）ではpointer lockを一切使わず、
// タップで直接プレイ状態に入る。視点・移動はタッチ操作（player.js）。
//
// デスクトップではポインタロックの「取得イベントが来たとき」だけプレイ状態に入る。
// Escやスクリーンショット直後の再ロックはブラウザが1秒強拒否するため、
// 失敗したらオーバーレイを出し直して次のクリックを待つ。
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let started = false;

function beginPlay() {
  if (state === 'ending') return;
  ui.hideTitle();
  if (!started) {
    started = true;
    ui.fadeIn(2.5);
  }
  state = 'playing';
  player.enable();
  ui.setReticleVisible(true);
}

function requestLock() {
  const p = renderer.domElement.requestPointerLock();
  if (p && typeof p.catch === 'function') {
    p.catch(() => {
      ui.showTitle(requestLock, { resumed: true, touch: IS_TOUCH });
    });
  }
}

ui.showTitle(() => {
  if (!audio.started) audio.start().then(() => loops.applyLoop(loops.index));
  if (IS_TOUCH) beginPlay();
  else requestLock();
}, { touch: IS_TOUCH });

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    beginPlay();
  } else if (state === 'playing' && !IS_TOUCH) {
    state = 'paused';
    player.disable();
    ui.setReticleVisible(false);
    if (silentPause) {
      // スクショ等のOS操作中: オーバーレイを出さず画面はそのまま。クリックで復帰
      silentPause = false;
    } else {
      ui.showTitle(requestLock, { resumed: true });
    }
  }
});

// 保険: ロックが外れたままならキャンバスクリックでも復帰できる（デスクトップのみ）
renderer.domElement.addEventListener('click', () => {
  if (!IS_TOUCH && started && state !== 'ending' && !document.pointerLockElement) requestLock();
});

// Ctrl/Cmd+Shift はOSショートカット（スクリーンショット等）の前置きなので、
// 押された瞬間にロックを自発的に解放してカーソルをOSへ返す。
// このときはオーバーレイを出さない（スクショにゲーム画面が写るように）
let silentPause = false;
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && document.pointerLockElement) {
    silentPause = true;
    document.exitPointerLock();
  }
});

// --- ループドア通過（シームレス） ---
// ドアの先には廊下Aの複製が見えている。敷居を1m越えたら、
// 複製内の位置をそのまま実座標へ写像してテレポートする（見た目は連続）。
//   x_real = z + 13,  z_real = 9.97 - x,  yaw += 90°
function passLoopDoor() {
  const p = player.position;
  loops.onDoorPass();
  player.teleport(p.z + 13, 9.97 - p.x, player.yaw + Math.PI / 2);
  post.pulse(0.15); // ほんのかすかな乱れ
  audio.creak();
  // 背後で玄関ドアがひとりでに閉まる（振り返ると閉まりかけが見える）
  corridor.entryDoor.angle = -1.5;
  corridor.entryDoor.hinge.rotation.y = -1.5;
  // ループドアは静かに閉じた状態へ戻す
  corridor.loopDoor.openTarget = 0;
  corridor.loopDoor.angle = 0;
  corridor.loopDoor.hinge.rotation.y = 0;
  setTimeout(() => audio.thud(), 1200); // ドアの閉まる鈍い音
}

// --- エンディング ---
function startEnding() {
  state = 'ending';
  player.disable();
  ui.setReticleVisible(false);
  audio.stinger('ending');
  audio.setHum(false);
  audio.setDrone(0);
  audio.setHeartbeat(0);
  ui.fadeOut(4, '#dfe6ee'); // 白い光に包まれる
  setTimeout(() => {
    ui.fadeEl.style.transition = 'background 4s ease';
    ui.fadeEl.style.background = '#000';
    ui.showEnding();
  }, 5000);
}

// --- メインループ ---
const clock = new THREE.Clock();
let time = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.066);
  time += dt;

  if (state === 'playing') {
    player.update(dt);
    loops.update(dt, camera);

    const p = player.position;
    const inHallB = p.z < -12.3;

    if (inHallB) {
      if (loops.isFinal) {
        // 最終ループ: ループドアは施錠されている
        if (p.x > 8.2) {
          p.x = 8.2;
          if (lockedThudCooldown <= 0) {
            audio.thud();
            ui.showHint('あかない', 2.5);
            lockedThudCooldown = 4;
          }
        }
      } else {
        // 近づくとひとりでに開く
        if (p.x > 6.2) corridor.loopDoor.setOpen(0.85);
        if (p.x > 10.0) passLoopDoor();
      }
    }

    // ドアが実際に開いているときだけ、その先へ歩ける
    player.loopOpen = !loops.isFinal && corridor.loopDoor.angle < -0.8;
    player.bathOpen = loops.bathEnterable;

    // 最終ループ: 開いた玄関から外へ
    if (loops.isFinal && p.z > 0.42 && Math.abs(p.x) < 0.6) {
      startEnding();
    }

    lockedThudCooldown -= dt;
  }

  corridor.update(dt, time);
  audio.update(dt);
  post.render(dt, time);
});

// デバッグ・自動テスト用フック
window.__game = {
  player, loops, corridor, audio, post,
  getState: () => state,
  forceStart: () => { // ヘッドレス環境などpointer lockが取れない場合の開始
    beginPlay();
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});
