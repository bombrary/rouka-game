// PS1/VHS風ポストプロセスパイプライン
// 低解像度RTにシーンを描き、VHSシェーダ1パスでcanvasへ合成する

import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D tDiffuse;
uniform vec2 uResolution;   // 低解像度RTのピクセルサイズ
uniform float uTime;
uniform float uPulse;       // 0..1 グリッチバースト（JS側で減衰）
uniform float uBaseNoise;   // 0..1 常時ノイズ量
uniform float uDarkness;    // 0..1 暗さ・ビネット

// ハッシュ系ノイズ
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  float t = uTime;

  // --- 垂直同期ずれ: pulseが強いとき画面全体が縦にロールする ---
  float vsync = smoothstep(0.45, 0.95, uPulse);
  uv.y = fract(uv.y + vsync * fract(t * 4.3));

  // --- VHSトラッキング歪み: 水平帯が間欠的に横ずれ＋ノイズ化 ---
  float slot = floor(t * 1.7);
  float bandOn = step(0.78, hash11(slot + 0.5));          // ときどき自然発生
  bandOn = max(bandOn, smoothstep(0.08, 0.4, uPulse));    // pulse時は強制発生
  float bandCenter = hash11(slot + 13.7);
  float bandHalf = 0.035 + 0.12 * uPulse;
  float band = bandOn * (1.0 - smoothstep(0.0, bandHalf, abs(uv.y - bandCenter)));
  float rowSeed = hash21(vec2(floor(uv.y * uResolution.y), floor(t * 60.0)));
  uv.x += band * (rowSeed - 0.5) * (0.035 + 0.15 * uPulse);

  // --- 色収差: RGBを水平にずらす（pulse・帯内で増幅） ---
  float ca = 0.0012 + 0.005 * uPulse + 0.003 * band;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;

  // --- 帯の中は信号が乱れて白ノイズが混ざる ---
  float bandNoise = hash21(uv * uResolution + vec2(t * 91.0, t * 47.0));
  col = mix(col, vec3(bandNoise * 0.7 + 0.15), band * 0.55);

  // --- 走査線: 細かい水平ライン、ゆっくりスクロール ---
  float scan = sin((uv.y + t * 0.03) * uResolution.y * 3.14159265);
  col *= 0.94 + 0.06 * scan;

  // --- フィルムノイズ: baseNoise + pulse で増える ---
  float grain = hash21(uv * uResolution + vec2(t * 123.4, t * 71.3));
  float noiseAmt = 0.035 + 0.3 * uBaseNoise + 0.4 * uPulse;
  col += (grain - 0.5) * noiseAmt;
  col = clamp(col, 0.0, 1.0);

  // --- 色調: 彩度を落とし、暗部を青緑に寄せる ---
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 0.72);
  col += vec3(-0.008, 0.018, 0.025) * (1.0 - smoothstep(0.0, 0.55, luma));

  // --- ビネット: darknessで締め付け＋全体減光 ---
  vec2 dc = vUv - 0.5;
  float vig = 1.0 - dot(dc, dc) * (1.3 + 2.4 * uDarkness);
  col *= clamp(vig, 0.0, 1.0);
  col *= 1.0 - 0.35 * uDarkness;

  // --- 量子化: 5bit相当＋ハッシュディザでレトロなバンディング ---
  float levels = 32.0;
  float dith = (hash21(gl_FragCoord.xy + fract(t) * 100.0) - 0.5) / levels;
  col = floor(clamp(col + dith, 0.0, 1.0) * levels + 0.5) / levels;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  #include <colorspace_fragment>
}
`;

export class VHSPipeline {
  constructor(renderer, scene, camera, { pixelScale = 4 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.pixelScale = Math.max(1, pixelScale);

    this._pulse = 0;

    // 低解像度レンダーターゲット（ニアレスト拡大でPS1風のドット感を出す）
    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });

    this.uniforms = {
      tDiffuse: { value: this.renderTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uBaseNoise: { value: 0 },
      uDarkness: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });

    // フルスクリーン大三角形（クアッドより頂点1つ少なく、継ぎ目も無い）
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    );
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = false;

    this.quadScene = new THREE.Scene();
    this.quadScene.add(mesh);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const size = renderer.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
  }

  setSize(width, height) {
    const pr = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor((width * pr) / this.pixelScale));
    const h = Math.max(1, Math.floor((height * pr) / this.pixelScale));
    this.renderTarget.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
  }

  render(dt, time) {
    // pulseの時間減衰（約0.4秒で1.0→0）
    this._pulse = Math.max(0, this._pulse - dt * 2.5);

    this.uniforms.uTime.value = time;
    this.uniforms.uPulse.value = this._pulse;

    const renderer = this.renderer;
    renderer.setRenderTarget(this.renderTarget);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  pulse(amount) {
    this._pulse = Math.min(1, Math.max(this._pulse, amount));
  }

  setBaseNoise(amount) {
    this.uniforms.uBaseNoise.value = Math.min(1, Math.max(0, amount));
  }

  setDarkness(amount) {
    this.uniforms.uDarkness.value = Math.min(1, Math.max(0, amount));
  }
}
