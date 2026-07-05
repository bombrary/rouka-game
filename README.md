# 廊下 — rouka

* L字廊下をループするP.T風ホラーゲーム
* Claude Code（Claude Fable 5）の能力を試すテスト
* テクスチャはCanvas 2D、音響はWeb Audio APIですべてプロシージャル生成しており、外部アセットを一切使っていない

**▶ プレイ: https://bombrary.github.io/rouka-game/**

- **WASD** 移動 / **マウス** 視点 / **クリック** 開始
- ヘッドホン推奨・デスクトップブラウザ向け
- 周回ごとに廊下のどこかが変わる。「おかしいところ」を見つけて、**しばらく見つめる**と先へ進める
- 気づかないままドアをくぐると、同じ廊下が続く

## 技術構成

Three.js + Vite。PS1/VHS風のポストエフェクト（低解像度レンダリング・走査線・トラッキング歪み）。

| ファイル | 役割 |
| --- | --- |
| `src/main.js` | 統合・ゲームステート・ループドア/脱出判定 |
| `src/corridor.js` | L字廊下の構築（ドア・額縁・ラジオ・ランプ・人影・壁の文字・浴室） |
| `src/anomalies.js` | アノマリープール（12種からプレイごとに抽選）・凝視認識・環境音イベント |
| `src/player.js` | 一人称操作・衝突・ヘッドボブ・足音 |
| `src/textures.js` | Canvas 2Dによるプロシージャルテクスチャ |
| `src/audio.js` | Web Audio APIによる全音響合成（ドローン・ラジオ・囁き・心音…） |
| `src/post.js` | PS1/VHS風ポストエフェクト |
| `src/ui.js` | タイトル・レティクル・フェード・エンディング |

## 開発

開発環境はNix flakeで完結する。

```sh
nix develop -c npm install   # 初回のみ
nix develop -c npm run dev   # http://localhost:5173
```

ビルドとプレビュー:

```sh
nix develop -c npm run build
nix develop -c npm run preview
```

`main` ブランチへのpushで、GitHub Actions（`.github/workflows/deploy.yml`）がビルドしてGitHub Pagesへ自動デプロイする。
