// DOMオーバーレイUI: タイトル・レティクル・フェード・ヒント・エンディング

export class UI {
  constructor(root) {
    this.root = root;

    this.layer = document.createElement('div');
    Object.assign(this.layer.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none',
      fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", serif',
      color: '#b8b4a8', userSelect: 'none', zIndex: '10',
    });
    root.appendChild(this.layer);

    // レティクル（凝視プログレスのリング付き）
    this.reticle = document.createElement('div');
    Object.assign(this.reticle.style, {
      position: 'absolute', left: '50%', top: '50%',
      width: '28px', height: '28px', transform: 'translate(-50%, -50%)',
      display: 'none',
    });
    this.reticle.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="1.4" fill="rgba(200,195,180,0.5)"/>
        <circle cx="14" cy="14" r="10" fill="none" stroke="rgba(200,195,180,0.55)"
          stroke-width="1.2" stroke-dasharray="62.8" stroke-dashoffset="62.8"
          transform="rotate(-90 14 14)" id="gaze-ring"/>
      </svg>`;
    this.layer.appendChild(this.reticle);
    this.gazeRing = this.reticle.querySelector('#gaze-ring');

    // フェード用レイヤ
    this.fadeEl = document.createElement('div');
    Object.assign(this.fadeEl.style, {
      position: 'absolute', inset: '0', background: '#000',
      opacity: '1', transition: 'opacity 1.5s ease',
    });
    this.layer.appendChild(this.fadeEl);

    // ヒントテキスト（画面下部にかすかに）
    this.hintEl = document.createElement('div');
    Object.assign(this.hintEl.style, {
      position: 'absolute', bottom: '12%', left: '0', right: '0',
      textAlign: 'center', fontSize: '15px', letterSpacing: '0.5em',
      color: 'rgba(180,175,160,0.0)', transition: 'color 1.2s ease',
    });
    this.layer.appendChild(this.hintEl);
    this._hintTimer = null;

    // タイトル / ポーズ画面
    this.titleEl = document.createElement('div');
    Object.assign(this.titleEl.style, {
      position: 'absolute', inset: '0', background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', pointerEvents: 'auto', cursor: 'pointer',
      gap: '2.2em', textAlign: 'center',
    });
    this.layer.appendChild(this.titleEl);
  }

  showTitle(onStart, { resumed = false, touch = false } = {}) {
    const tapWord = touch ? 'タップ' : 'クリック';
    const controls = touch
      ? 'ひだりはんぶん　あるく<br>みぎはんぶん　みまわす<br><br>ヘッドホン推奨'
      : 'WASD　あるく<br>マウス　みまわす<br><br>ヘッドホン推奨';
    this.titleEl.innerHTML = resumed
      ? `<div style="font-size:15px;letter-spacing:0.6em;opacity:0.7">${tapWord}で戻る</div>`
      : `
      <div style="font-size:44px;letter-spacing:0.9em;text-indent:0.9em">廊　下</div>
      <div style="font-size:13px;letter-spacing:0.35em;opacity:0.55;line-height:2.4">
        ${controls}
      </div>
      <div style="font-size:15px;letter-spacing:0.6em;opacity:0.8">${tapWord}ではじめる</div>`;
    this.titleEl.style.display = 'flex';
    this.titleEl.onclick = () => {
      this.titleEl.style.display = 'none';
      onStart();
    };
  }

  hideTitle() {
    this.titleEl.style.display = 'none';
  }

  setReticleVisible(v) {
    this.reticle.style.display = v ? 'block' : 'none';
  }

  // 0..1
  setGazeProgress(p) {
    const c = 62.8;
    this.gazeRing.setAttribute('stroke-dashoffset', String(c * (1 - Math.max(0, Math.min(1, p)))));
  }

  fadeIn(sec = 1.5) {
    this.fadeEl.style.background = '#000';
    this.fadeEl.style.transition = `opacity ${sec}s ease`;
    this.fadeEl.style.opacity = '0';
  }

  fadeOut(sec = 1.5, color = '#000') {
    this.fadeEl.style.background = color;
    this.fadeEl.style.transition = `opacity ${sec}s ease`;
    this.fadeEl.style.opacity = '1';
  }

  showHint(text, duration = 2.5) {
    this.hintEl.textContent = text;
    this.hintEl.style.color = 'rgba(180,175,160,0.75)';
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      this.hintEl.style.color = 'rgba(180,175,160,0.0)';
    }, duration * 1000);
  }

  showEnding() {
    this.setReticleVisible(false);
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', inset: '0', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '3em', opacity: '0', transition: 'opacity 4s ease',
    });
    el.innerHTML = `
      <div style="font-size:40px;letter-spacing:0.9em;text-indent:0.9em">廊　下</div>
      <div style="font-size:12px;letter-spacing:0.4em;opacity:0.5">そとに　でられた</div>`;
    this.layer.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
  }
}
