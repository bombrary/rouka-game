// audio.js - P.T.ライクホラー用プロシージャル音響エンジン
// 外部アセットなし。すべてWeb Audio APIで合成する。

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

export class AudioEngine {
  constructor() {
    // autoplay制限のため、ここではAudioContextを作らない
    this.ctx = null;
    this._started = false;

    // start()前に呼ばれた設定を覚えておき、start()時に適用する
    this._masterVolume = 0.9;
    this._droneLevel = 0;
    this._humOn = false;
    this._radioOn = false;
    this._radioPan = 0;
    this._breathOn = false;
    this._breathPan = 0;
    this._heartBpm = 0;

    // update()用の内部時間・タイマー
    this._time = 0;
    this._humTimer = 0;
    this._radioTimer = 0;
    this._heartTimer = 0;
    this._breathPhase = 0;
    this._breathCycle = 4.2;
  }

  get started() {
    return this._started;
  }

  async start() {
    if (this._started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch (e) { /* 無視 */ }
      }
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    try { await this.ctx.resume(); } catch (e) { /* 無視 */ }

    const ctx = this.ctx;

    // ---- マスターチェーン: master -> compressor -> destination ----
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.25;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this._masterVolume;
    this.master.connect(this.compressor);

    // ---- 廊下の残響（自前生成インパルス応答）----
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    const convolver = ctx.createConvolver();
    convolver.buffer = this._makeImpulse(2.2, 3.2);
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.3;
    this.reverbSend.connect(convolver);
    convolver.connect(reverbWet);
    reverbWet.connect(this.master);

    // ---- 共有ノイズバッファ ----
    this._noiseBuffer = this._makeNoiseBuffer(2.0);

    this._setupDrone();
    this._setupHum();
    this._setupRadio();
    this._setupBreathing();

    this._started = true;

    // start()前に指定された状態を適用
    const dl = this._droneLevel; this._droneLevel = -1; this.setDrone(dl);
    if (this._humOn) { this._humOn = false; this.setHum(true); }
    if (this._radioOn) { this._radioOn = false; this.setRadio(true, this._radioPan); }
    if (this._breathOn) { this._breathOn = false; this.setBreathing(true, this._breathPan); }
  }

  // ------------------------------------------------------------
  // 内部ヘルパー
  // ------------------------------------------------------------

  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _noiseSource(loop) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = !!loop;
    return src;
  }

  // 出力へ接続。pan指定でパンナーを挟み、revで残響へ送る量を指定
  _toOut(node, rev, pan) {
    let tail = node;
    if (pan !== undefined && pan !== null) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      tail.connect(p);
      tail = p;
    }
    tail.connect(this.master);
    if (rev > 0) {
      const g = this.ctx.createGain();
      g.gain.value = rev;
      tail.connect(g);
      g.connect(this.reverbSend);
    }
  }

  // ------------------------------------------------------------
  // ドローン（恐怖の底流）
  // ------------------------------------------------------------

  _setupDrone() {
    const ctx = this.ctx;
    // 集約 -> 揺らぎ用ゲイン -> master
    this._droneSum = ctx.createGain();
    this._droneWobble = ctx.createGain(); // update()が直接値を書く専用
    this._droneSum.connect(this._droneWobble);
    this._droneWobble.connect(this.master);
    const rev = ctx.createGain();
    rev.gain.value = 0.5;
    this._droneSum.connect(rev);
    rev.connect(this.reverbSend);

    const mk = (type, freq) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(this._droneSum);
      osc.start();
      return { osc, g };
    };
    this._droneA = mk('sine', 55);        // 基音
    this._droneB = mk('sine', 55);        // デチューン相方（setDroneでdetune変更）
    this._droneC = mk('sine', 77.8);      // 三全音付近の不協和音
    this._droneD = mk('sine', 110.7);     // 少しずれたオクターブ

    // フィルタしたノイズ層
    const n = this._noiseSource(true);
    this._droneFilter = ctx.createBiquadFilter();
    this._droneFilter.type = 'lowpass';
    this._droneFilter.frequency.value = 120;
    this._droneFilter.Q.value = 0.7;
    this._droneNoiseGain = ctx.createGain();
    this._droneNoiseGain.gain.value = 0;
    n.connect(this._droneFilter);
    this._droneFilter.connect(this._droneNoiseGain);
    this._droneNoiseGain.connect(this._droneSum);
    n.start();
  }

  setDrone(level) {
    level = clamp(level || 0, 0, 1);
    if (!this._started) { this._droneLevel = level; return; }
    if (level === this._droneLevel) return;
    this._droneLevel = level;
    const t = this.ctx.currentTime;
    const tc = 1.6; // 数秒かけて遷移
    this._droneA.g.gain.setTargetAtTime(0.20 * level, t, tc);
    this._droneB.g.gain.setTargetAtTime(0.16 * level, t, tc);
    this._droneC.g.gain.setTargetAtTime(0.11 * level * level, t, tc);
    this._droneD.g.gain.setTargetAtTime(0.08 * level * level, t, tc);
    this._droneNoiseGain.gain.setTargetAtTime(0.03 * level + 0.06 * level * level, t, tc);
    // levelが上がるほどデチューンが増えて不協和に
    this._droneB.osc.detune.setTargetAtTime(4 + 28 * level, t, tc);
    this._droneFilter.frequency.setTargetAtTime(120 + 380 * level, t, tc);
  }

  // ------------------------------------------------------------
  // 蛍光灯のハム音
  // ------------------------------------------------------------

  _setupHum() {
    const ctx = this.ctx;
    this._humGain = ctx.createGain();      // on/off（スケジュール用）
    this._humGain.gain.value = 0;
    this._humAm = ctx.createGain();        // 不規則なAM揺らぎ用
    this._humAm.gain.value = 1;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.Q.value = 1.2;

    const osc60 = ctx.createOscillator();
    osc60.type = 'sawtooth';
    osc60.frequency.value = 60;
    const g60 = ctx.createGain();
    g60.gain.value = 0.7;
    osc60.connect(g60);
    g60.connect(lp);

    // 蛍光灯特有の2倍波
    const osc120 = ctx.createOscillator();
    osc120.type = 'square';
    osc120.frequency.value = 120;
    const g120 = ctx.createGain();
    g120.gain.value = 0.25;
    osc120.connect(g120);
    g120.connect(lp);

    lp.connect(this._humAm);
    this._humAm.connect(this._humGain);
    this._humGain.connect(this.master);
    osc60.start();
    osc120.start();
  }

  setHum(on) {
    if (!this._started) { this._humOn = !!on; return; }
    on = !!on;
    if (on === this._humOn) return;
    this._humOn = on;
    const t = this.ctx.currentTime;
    this._humGain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.3);
    if (on) this._humTimer = rand(0.3, 1.5);
  }

  // ------------------------------------------------------------
  // 足音（硬い木の床）
  // ------------------------------------------------------------

  footstep() {
    if (!this._started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const r = rand(0.9, 1.1); // ピッチ±10%
    const v = rand(0.9, 1.1); // 音量±10%

    // 低域の踏み込み
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 * r, t);
    osc.frequency.exponentialRampToValueAtTime(42 * r, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.4 * v, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(og);
    this._toOut(og, 0.15);
    osc.start(t);
    osc.stop(t + 0.16);

    // 靴底のコツッというノイズ
    const n = this._noiseSource(false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 * r;
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.22 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(bp);
    bp.connect(ng);
    this._toOut(ng, 0.2);
    n.start(t, rand(0, 1.5));
    n.stop(t + 0.08);
  }

  // ------------------------------------------------------------
  // ラジオ（狭帯域ノイズ＋言葉にならない呟き）
  // ------------------------------------------------------------

  _setupRadio() {
    const ctx = this.ctx;
    this._radioGain = ctx.createGain(); // on/off
    this._radioGain.gain.value = 0;
    this._radioPanner = ctx.createStereoPanner();
    this._radioGain.connect(this._radioPanner);
    this._radioPanner.connect(this.master);
    const rev = ctx.createGain();
    rev.gain.value = 0.25;
    this._radioPanner.connect(rev);
    rev.connect(this.reverbSend);

    // 帯域の狭いノイズ（AMラジオの砂嵐）
    const n = this._noiseSource(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1350;
    bp.Q.value = 2.2;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    n.connect(bp);
    bp.connect(ng);
    ng.connect(this._radioGain);
    n.start();

    // 声のような変調：鋸波をフォルマント風の帯域通過3本に通す
    this._radioVoiceOsc = ctx.createOscillator();
    this._radioVoiceOsc.type = 'sawtooth';
    this._radioVoiceOsc.frequency.value = 115;
    this._radioVoiceGain = ctx.createGain();
    this._radioVoiceGain.gain.value = 0;
    this._radioFormants = [];
    const formantDefs = [[520, 7, 1.0], [1150, 9, 0.55], [2450, 11, 0.3]];
    for (const [f, q, a] of formantDefs) {
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.frequency.value = f;
      bpf.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = a;
      this._radioVoiceOsc.connect(bpf);
      bpf.connect(g);
      g.connect(this._radioVoiceGain);
      this._radioFormants.push(bpf);
    }
    this._radioVoiceGain.connect(this._radioGain);
    this._radioVoiceOsc.start();
  }

  setRadio(on, pan = 0) {
    if (!this._started) { this._radioOn = !!on; this._radioPan = pan; return; }
    on = !!on;
    const t = this.ctx.currentTime;
    this._radioPanner.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.1);
    if (on === this._radioOn) return;
    this._radioOn = on;
    this._radioGain.gain.setTargetAtTime(on ? 0.3 : 0, t, 0.4);
    if (on) this._radioTimer = rand(1.0, 3.0);
  }

  // 聞き取れない呟きを1フレーズ分スケジュールする
  _radioMumble() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = rand(0.6, 1.8);
    const vg = this._radioVoiceGain.gain;
    vg.cancelScheduledValues(t);
    vg.setValueAtTime(0, t);
    let ti = t + 0.02;
    while (ti < t + dur) {
      const a = rand(0.2, 0.5);
      const up = rand(0.02, 0.07);
      const hold = rand(0.04, 0.13);
      const down = rand(0.04, 0.1);
      vg.linearRampToValueAtTime(a, ti + up);
      vg.linearRampToValueAtTime(a * 0.35, ti + up + hold);
      vg.linearRampToValueAtTime(0, ti + up + hold + down);
      // 音節ごとにピッチと母音（フォルマント）を揺らす
      this._radioVoiceOsc.frequency.setTargetAtTime(rand(85, 160), ti, 0.05);
      this._radioFormants[0].frequency.setTargetAtTime(rand(350, 800), ti, 0.06);
      this._radioFormants[1].frequency.setTargetAtTime(rand(900, 1700), ti, 0.06);
      ti += up + hold + down + rand(0, 0.09);
    }
  }

  // 静電気のパチッというクラックル
  _radioCrackle() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._noiseSource(false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(rand(0.1, 0.25), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    n.connect(hp);
    hp.connect(g);
    g.connect(this._radioGain);
    n.start(t, rand(0, 1.5));
    n.stop(t + 0.04);
  }

  // ------------------------------------------------------------
  // 呼吸（ドアの隙間から、遅く湿った）
  // ------------------------------------------------------------

  _setupBreathing() {
    const ctx = this.ctx;
    this._breathOnGain = ctx.createGain(); // on/off（スケジュール用）
    this._breathOnGain.gain.value = 0;
    this._breathEnv = ctx.createGain();    // update()が直接値を書く専用
    this._breathEnv.gain.value = 0;
    this._breathPanner = ctx.createStereoPanner();

    const n = this._noiseSource(true);
    this._breathFilter = ctx.createBiquadFilter(); // update()が直接値を書く専用
    this._breathFilter.type = 'bandpass';
    this._breathFilter.frequency.value = 900;
    this._breathFilter.Q.value = 0.8;
    n.connect(this._breathFilter);
    this._breathFilter.connect(this._breathEnv);

    // 高域のかすれ（湿った質感）
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2600;
    bp2.Q.value = 1.5;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    n.connect(bp2);
    bp2.connect(g2);
    g2.connect(this._breathEnv);

    this._breathEnv.connect(this._breathOnGain);
    this._breathOnGain.connect(this._breathPanner);
    this._breathPanner.connect(this.master);
    n.start();
  }

  setBreathing(on, pan = 0) {
    if (!this._started) { this._breathOn = !!on; this._breathPan = pan; return; }
    on = !!on;
    const t = this.ctx.currentTime;
    this._breathPanner.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.1);
    if (on === this._breathOn) return;
    this._breathOn = on;
    this._breathOnGain.gain.setTargetAtTime(on ? 1 : 0, t, 0.6);
    if (on) { this._breathPhase = 0; this._breathCycle = rand(3.8, 5.2); }
  }

  // ------------------------------------------------------------
  // 囁き（言葉にならない子音的バースト）
  // ------------------------------------------------------------

  whisper(pan = 0) {
    if (!this._started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = rand(1.0, 2.0);

    const n = this._noiseSource(false);
    n.loop = true; // durが長いのでループさせて後で止める
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = rand(2200, 3000);
    bp1.Q.value = 4;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = rand(3400, 4200);
    bp2.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    n.connect(bp1);
    n.connect(bp2);
    bp1.connect(g);
    bp2.connect(g);

    // 子音のような短いブリップを連ねる
    let ti = t + 0.03;
    while (ti < t + dur - 0.1) {
      const a = rand(0.08, 0.22);
      const up = rand(0.015, 0.05);
      const down = rand(0.04, 0.14);
      g.gain.linearRampToValueAtTime(a, ti + up);
      g.gain.linearRampToValueAtTime(a * 0.15, ti + up + down);
      bp1.frequency.setTargetAtTime(rand(1800, 3200), ti, 0.04);
      ti += up + down + rand(0.01, 0.12);
    }
    g.gain.linearRampToValueAtTime(0, t + dur);

    this._toOut(g, 0.45, pan);
    n.start(t, rand(0, 1.5));
    n.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------
  // 心音
  // ------------------------------------------------------------

  setHeartbeat(bpm) {
    bpm = Math.max(0, bpm || 0);
    const wasOff = this._heartBpm <= 0;
    this._heartBpm = bpm;
    if (bpm > 0 && wasOff) this._heartTimer = 0.1; // すぐ最初の一拍
  }

  _heartPulse(when, strength, freq) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, when + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(strength, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    osc.connect(g);
    this._toOut(g, 0);
    osc.start(when);
    osc.stop(when + 0.25);
  }

  _heartBeat() {
    const t = this.ctx.currentTime;
    // ドクッ・ドク の2連パルス
    this._heartPulse(t, 0.45, 52);
    this._heartPulse(t + 0.17, 0.28, 58);
  }

  // ------------------------------------------------------------
  // 環境ワンショット
  // ------------------------------------------------------------

  // 遠くで何かが落ちた鈍い音
  thud() {
    if (!this._started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const r = rand(0.85, 1.15);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(65 * r, t);
    osc.frequency.exponentialRampToValueAtTime(32 * r, t + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.4, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(og);
    this._toOut(og, rand(0.4, 1.0), rand(-0.5, 0.5)); // ランダムな残響感
    osc.start(t);
    osc.stop(t + 0.6);

    const n = this._noiseSource(false);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320 * r;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(lp);
    lp.connect(ng);
    this._toOut(ng, rand(0.3, 0.9));
    n.start(t, rand(0, 1.5));
    n.stop(t + 0.2);
  }

  // 木のきしみ／ドアの軋み
  creak() {
    if (!this._started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = rand(1.2, 2.4);
    const f0 = rand(150, 340);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;

    // ゆっくり不規則なピッチベンド
    osc.frequency.setValueAtTime(f0, t);
    bp.frequency.setValueAtTime(f0 * 2.5, t);
    let ti = t;
    let f = f0;
    while (ti < t + dur) {
      ti += rand(0.2, 0.55);
      f = clamp(f * rand(0.75, 1.5), 80, 900);
      osc.frequency.linearRampToValueAtTime(f, ti);
      bp.frequency.linearRampToValueAtTime(f * 2.5, ti);
    }

    // スティックスリップ的なざらつき（AM）
    const am = ctx.createGain();
    am.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(rand(8, 17), t);
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.45;
    lfo.connect(lfoG);
    lfoG.connect(am.gain);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.13, t + dur * 0.25);
    g.gain.setValueAtTime(0.13, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);

    osc.connect(bp);
    bp.connect(am);
    am.connect(g);
    this._toOut(g, 0.5, rand(-0.4, 0.4));
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------
  // スティンガー
  // ------------------------------------------------------------

  stinger(kind) {
    if (!this._started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    if (kind === 'recognize') {
      // 耳元で空気が変わるような短い上昇音
      const n = this._noiseSource(false);
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(6000, t + 0.55);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.16, t + 0.3);
      ng.gain.linearRampToValueAtTime(0, t + 0.75);
      n.connect(bp);
      bp.connect(ng);
      this._toOut(ng, 0.5);
      n.start(t, rand(0, 1.5));
      n.stop(t + 0.8);

      // わずかにうなる高音のペア
      for (const f of [2960, 2978]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.25);
        g.gain.linearRampToValueAtTime(0, t + 0.8);
        o.connect(g);
        this._toOut(g, 0.3);
        o.start(t);
        o.stop(t + 0.85);
      }
    } else if (kind === 'loop') {
      // ループのつなぎ目のグリッチ音
      const blips = 3 + Math.floor(Math.random() * 3);
      let ti = t;
      for (let i = 0; i < blips; i++) {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = rand(200, 2200);
        const g = ctx.createGain();
        const d = rand(0.015, 0.05);
        g.gain.setValueAtTime(0.09, ti);
        g.gain.setValueAtTime(0.09, ti + d - 0.005);
        g.gain.linearRampToValueAtTime(0, ti + d);
        o.connect(g);
        this._toOut(g, 0.2, rand(-0.6, 0.6));
        o.start(ti);
        o.stop(ti + d + 0.01);
        ti += d + rand(0.01, 0.05);
      }
      this.glitchBurst(0.12);
    } else if (kind === 'dark') {
      // 照明が落ちる時の低いフォール音
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(27, t + 1.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(55, t + 1.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.08);
      g.gain.setTargetAtTime(0, t + 0.9, 0.4);
      osc.connect(lp);
      lp.connect(g);
      this._toOut(g, 0.6);
      osc.start(t);
      osc.stop(t + 2.6);
    } else if (kind === 'ending') {
      // 静かで長い、解決しない和音（短2度と三全音のクラスタ）
      const freqs = [110, 116.54, 155.56, 220, 233.08];
      const dur = 14; // リリースが十分減衰しきるまで鳴らす
      for (const f of freqs) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * rand(0.998, 1.002);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.045, t + 3.0);
        g.gain.setValueAtTime(0.045, t + 6.0);
        g.gain.setTargetAtTime(0, t + 6.0, 2.2);
        o.connect(g);
        this._toOut(g, 0.9);
        o.start(t);
        o.stop(t + dur);
      }
    }
  }

  // VHSグリッチのザッというノイズバースト
  glitchBurst(duration = 0.15) {
    if (!this._started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    duration = clamp(duration, 0.02, 1.0);

    const n = this._noiseSource(false);
    n.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    // 細切れのゲートでザッザッと刻む
    g.gain.setValueAtTime(0, t);
    let ti = t;
    while (ti < t + duration) {
      g.gain.setValueAtTime(Math.random() < 0.75 ? rand(0.15, 0.32) : 0, ti);
      ti += rand(0.008, 0.03);
    }
    g.gain.setValueAtTime(0, t + duration);
    n.connect(hp);
    hp.connect(g);
    this._toOut(g, 0.15);
    n.start(t, rand(0, 1.5));
    n.stop(t + duration + 0.02);
  }

  // ------------------------------------------------------------
  // マスター
  // ------------------------------------------------------------

  setMasterVolume(v) {
    this._masterVolume = clamp(v, 0, 1);
    if (!this._started) return;
    this.master.gain.setTargetAtTime(this._masterVolume, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------
  // 毎フレーム更新（LFO・タイマー系）
  // ------------------------------------------------------------

  update(dt) {
    if (!this._started) return;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this._time += dt;
    const tm = this._time;

    // ドローンのゆっくりした揺らぎ（直接値を書く。スケジュールとは非干渉）
    this._droneWobble.gain.value =
      1 + 0.07 * Math.sin(tm * 2 * Math.PI * 0.05) + 0.04 * Math.sin(tm * 2 * Math.PI * 0.013 + 1.7);
    this._droneC.osc.detune.value = 14 * this._droneLevel * Math.sin(tm * 2 * Math.PI * 0.031 + 0.8);

    // ハムの不規則なAM揺らぎ
    if (this._humOn) {
      this._humTimer -= dt;
      if (this._humTimer <= 0) {
        const t = this.ctx.currentTime;
        const dip = rand(0.45, 0.85);
        this._humAm.gain.setTargetAtTime(dip, t, 0.02);
        this._humAm.gain.setTargetAtTime(1, t + rand(0.03, 0.12), 0.05);
        this._humTimer = rand(0.25, 2.8);
      }
    }

    // ラジオの呟き・クラックル
    if (this._radioOn) {
      this._radioTimer -= dt;
      if (this._radioTimer <= 0) {
        if (Math.random() < 0.7) {
          this._radioMumble();
          this._radioTimer = rand(2.5, 8.0);
        } else {
          this._radioCrackle();
          this._radioTimer = rand(0.5, 2.0);
        }
      }
    }

    // 呼吸のエンベロープ（直接値を書く）
    if (this._breathOn || this._breathOnGain.gain.value > 0.001) {
      this._breathPhase += dt / this._breathCycle;
      if (this._breathPhase >= 1) {
        this._breathPhase -= 1;
        this._breathCycle = rand(3.6, 5.4); // 周期を毎回少し変える
      }
      const p = this._breathPhase;
      let env = 0;
      let filt = 900;
      if (p < 0.38) {
        // 吸気（少し高めのかすれ）
        env = 0.75 * Math.pow(Math.sin(Math.PI * p / 0.38), 1.4);
        filt = 1300;
      } else if (p >= 0.48 && p < 0.95) {
        // 呼気（低く、湿って重い）
        env = 1.0 * Math.pow(Math.sin(Math.PI * (p - 0.48) / 0.47), 1.2);
        filt = 650;
      }
      // 湿ったざらつきのフラッター
      env *= 1 + 0.16 * Math.sin(tm * 43) * Math.sin(tm * 7.3);
      this._breathEnv.gain.value = Math.max(0, env * 0.14);
      this._breathFilter.frequency.value = filt;
    }

    // 心音
    if (this._heartBpm > 0) {
      this._heartTimer -= dt;
      if (this._heartTimer <= 0) {
        this._heartBeat();
        this._heartTimer += 60 / this._heartBpm;
        if (this._heartTimer <= 0) this._heartTimer = 60 / this._heartBpm;
      }
    }
  }
}
