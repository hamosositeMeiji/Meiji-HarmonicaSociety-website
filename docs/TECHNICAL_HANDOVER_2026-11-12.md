# ハモソ公式サイト 技術・運用引き継ぎ書

- 作成日：2026-11-12
- 対象リポジトリ：`hamosositeMeiji/Meiji-HarmonicaSociety-website`
- 対象ブランチ：この文書は `docs/technical-handover-2026-11-12` に作成
- 文書区分：内部開発・保守資料（公開リポジトリに置くため、秘密情報・非公開個人情報は記載しない）

> **重要：** この文書は2026-11-12時点でGitHubの `main` にあるREADME、管理画面、Worker、設定手順、公開お問い合わせページ等を確認して作成した。Cloudflare本番KVの中身、Cloudflare Dashboardの実設定、Search Consoleの現在の状態、実ブラウザでの全ページ動作まではこの調査だけでは確認していない。未確認項目は「要実機確認」と表記する。

---

## 1. プロジェクトの目的・基本原則

明治大学ハーモニカソサエティー（ハモソ）の公式サイトを運営する。旧サイトの単純復元ではなく、活動・演奏・新歓・部員情報を継続的に発信できる新しいサイトを維持・改善する。

### 開発原則

1. 部員の安全と個人情報保護を最優先する。
2. 公開に同意した写真・紹介情報だけを掲載する。
3. ユーザーはブラウザ中心のGitHub操作を希望している。ローカル環境の構築を前提にしない。
4. 既存機能・データを調べずに削除・置換しない。
5. 修正は作業ブランチで行い、Pull Requestと自動検査を通してから `main` に反映する。
6. コード変更だけで完了とせず、GitHub PagesとCloudflare Workerの両方の反映を確認する。
7. 未確認の障害・脆弱性を事実として断定しない。
8. 影響が小さい作業はまとめて進め、データ消失・認証障害・公開停止など重大リスクがある場合は作業を止めて報告する。

## 2. 現行リポジトリ・公開環境

| 項目 | 確認値 |
|---|---|
| GitHub | https://github.com/hamosositeMeiji/Meiji-HarmonicaSociety-website |
| 公開サイト | https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/ |
| デフォルト／公開ブランチ | `main` |
| 監査・再構築ブランチ | `audit/rebuild-2026` |
| 管理画面 | https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/admin/index.html |
| Cloudflare Worker | `hamoso-admin-auth.hamososaitoguanli.workers.dev` |
| Workerソース | `admin/worker.js` |
| 管理画面設定資料 | `admin/SETUP.md` |

リポジトリはPublic。公開リポジトリに秘密値、認証情報、非公開の部員データ、非公開の連絡先、バックアップJSONをコミットしない。

### ブランチ運用

- `main`：公開サイトの基準ブランチ。
- `audit/rebuild-2026`：監査・再構築用。現時点でmainと同一とは限らない。
- `fix/*`、`feature/*`、`docs/*`、`chore/*` 等の作業ブランチが複数存在する。
- ブランチ名だけで修正完了・未完了を判断しない。各ブランチの差分、PR、mainへの取り込み状況を確認する。
- 複数の修正ブランチをまとめてmainへマージしない。依存関係・競合・対象コミットを確認する。
- READMEではPR運用を指定している。mainへの直接pushは避ける。
- `main` のブランチ保護設定はGitHub Settingsで別途確認する。README上では設定手順が案内されているが、実際に有効かは未確認。

## 3. デプロイ構成

このサイトには独立した2つのデプロイ先がある。

### A. GitHub Pages（公開Webページ）

- 公開対象は `main`。
- main更新後、GitHub ActionsのPages build and deploymentで公開される。
- デプロイ後、Actionsが成功したことと公開URLの表示を確認する。

### B. Cloudflare Worker（認証・API・画像）

- Workerのソースは `admin/worker.js`。
- GitHubへコミットしただけではCloudflare上のWorkerは更新されない。
- Workerを変更した場合はCloudflare Dashboardからコードを更新してデプロイする。
- デプロイ後はログイン、セッション確認、管理API、公開API、画像配信を確認する。
- GitHub PagesとWorkerの片方だけを更新した状態を「全体反映済み」と報告しない。

## 4. ディレクトリ・主要ファイル案内

READMEおよび現行コードで確認できた範囲。

| パス | 役割・注意 |
|---|---|
| `admin/index.html` | 運営ダッシュボード。各編集画面・バックアップ画面への入口 |
| `admin/login.html` | 管理ログイン画面（存在する画面へのリンクをダッシュボードが使用） |
| `admin/site-content.html` | 活動紹介、写真、動画、SNS、入会案内、役員、サイト管理者、予定の編集 |
| `admin/announcements.html` | お知らせ・演奏会情報の管理 |
| `admin/backup.html` | バックアップ・復元 |
| `admin/worker.js` | Cloudflare Workerの認証/API/画像/データ保存処理 |
| `admin/SETUP.md` | Worker、KV、Secrets、画像、バックアップ、Search Console等の設定手順 |
| `admin/config.yml` | 旧Decap CMS/Git Gateway向け設定。現行管理画面では読み込まれない |
| `content/site.json` | 旧CMS時代の参考データ。現行サイトの保存先ではない |
| `activities/` | 活動紹介ページ |
| `contact/index.html` | お問い合わせページ。役員・SNS情報を公開APIから読み込む処理がある |
| `events/` | 演奏会・イベント |
| `parts/` | パート紹介 |
| `schedule/` | 年間スケジュール |
| `news/` | お知らせ・年度別アーカイブ |
| `shared/` | 共通UI・アクセシビリティ関連 |
| `scripts/site-audit.mjs` | リポジトリ品質監査スクリプト |
| `.github/workflows/site-quality.yml` | PR/main push時の品質検査 |

上記以外のファイルを編集する場合は、GitHub上で現行ファイルと参照関係を確認してから着手する。ファイル名を推測して新規作成しない。

## 5. 管理画面の機能・データ項目

### ダッシュボード

現行 `admin/index.html` には次の入口がある。

- お知らせ・演奏会情報
- 写真・活動紹介
- 演奏動画・SNS
- サイト情報・入会案内
- 役員・お問い合わせ先
- データのバックアップ・復元

### サイト情報管理

現行 `admin/site-content.html` に以下の編集領域がある。

- 活動紹介：見出し、本文、写真URL
- 写真：JPEG/PNG/WebP、1枚1.5MBまでのアップロード、プレビュー、保存画像の削除、既存画像の保存期限延長
- 演奏動画：タイトルとURL、またはURL単独
- SNS：Instagram、X、YouTube、その他URL
- 入会案内：見出し、本文、見学案内、問い合わせURL
- 役員・お問い合わせ先：最大3名
- サイト管理者：役員とは別枠で最大3名
- 活動・年間予定：定例練習、活動場所、注意書き、年間予定

### サイト作成者・役員の扱い

- サイト作成者は固定情報として扱い、年度ごとの役員編集欄に混ぜない。
- サイト作成者の学年表示は年度に応じて切り替える仕様。
- サイト管理者はサイト作成者・年度役員と別枠。
- 役員・サイト管理者の入力は最大各3名。
- 管理画面の保存処理は `contacts.peopleConfigured=true` を保存し、役員を明示的に空にした場合に古い既定役員へ戻らないようにする仕様。
- 氏名・役職・メールアドレスは、現役運営担当者から確認した情報だけを入力する。推測で復元しない。

### お問い合わせページの注意

`contact/index.html` は、最初にHTML内の表示内容を用意し、その後 `/api/public/site-content` から連絡先・SNSを読み込んで置き換える構成。

そのため、API取得失敗時はHTML内の既定表示が残る可能性がある。年度交代時は、KVの登録内容だけでなく、HTML側の既定表示も現行情報と一致しているか確認する。古い役員名・連絡先を表示したままにしない。

問い合わせフォームはGoogle Formsの埋め込み。Worker内に問い合わせ受信箱はない。フォームの編集権限は必要な運営担当者に限定する。

## 6. Cloudflare Worker・API構成

### Workerの設定

`admin/SETUP.md` で確認した必須設定：

- KV binding名：`LOGIN_LIMITS`
- Secret：`ADMIN_PASSWORD`
- Secret：`SESSION_SECRET`
- Worker URL：Cloudflareが実際に発行したURLを使用する

秘密値はGitHub、チャット、公開文書に書かない。年度更新時はADMIN_PASSWORDとSESSION_SECRETを変更し、旧セッションを無効化する。

### 認証仕様（ソースコード確認）

- ログイン試行：IPごとに15分間で最大5回。
- セッション有効期間：8時間。
- HMAC-SHA256署名付きトークン。
- セッションIDはKVに保存し、ログアウト時に無効化。
- 管理APIはBearer tokenによるセッション確認を行う。
- CORS許可元は `https://hamosositemeiji.github.io`。
- Originが異なるリクエストは拒否する設計。

### API一覧（mainのWorkerソースで確認）

| メソッド | パス | 用途 | 認証 |
|---|---|---|---|
| POST | `/api/login` | 管理ログイン | パスワード照合 |
| GET | `/api/session` | セッション確認 | Bearer token |
| POST | `/api/logout` | ログアウト | Bearer token |
| GET | `/api/site-content` | サイト情報の管理用取得 | 必要 |
| POST | `/api/site-content` | サイト情報の保存 | 必要 |
| GET | `/api/public/site-content` | 公開用サイト情報 | 不要 |
| GET | `/api/announcements` | お知らせ管理用取得 | 必要 |
| POST | `/api/announcements` | お知らせ保存 | 必要 |
| GET | `/api/public/announcements` | 公開中のお知らせ取得 | 不要 |
| POST | `/api/media` | 画像アップロード | 必要 |
| GET | `/media/{id}` | 公開画像の配信 | 不要 |
| DELETE | `/api/media/{id}` | 画像削除 | 必要 |
| POST | `/api/media/extend-retention` | 既存画像の保存期限延長 | 必要 |
| GET | `/api/backup/export` | コンテンツバックアップ出力 | 必要 |
| GET | `/api/backup/export-media` | 画像バックアップ出力（ページング） | 必要 |
| POST | `/api/backup/restore-media` | 画像復元 | 必要 |
| POST | `/api/backup/restore-content` | コンテンツ復元 | 必要 |
| POST | `/api/backup/restore-latest-snapshot` | KVスナップショットから復元 | 必要 |

APIを変更した場合は、管理画面側の呼び出し・公開ページ側の呼び出し・CORS・認証・入力検証をセットで確認する。

### KVキー（Workerソースで確認）

- `content:site-content`：活動・メディア・募集・予定・連絡先等
- `content:announcements`：お知らせ一覧
- `revision:site-content`：サイト情報のrevision
- `revision:announcements`：お知らせのrevision
- `media:{id}`：アップロード画像
- `session:{sid}`：有効セッション
- `login:{ip}`：ログイン試行制限
- `backup:site-content:{timestamp}`：サイト情報の保存前スナップショット
- `backup:announcements:{timestamp}`：お知らせの保存前スナップショット

すべて `LOGIN_LIMITS` KV bindingを利用する。Cloudflare Dashboard上の実際のbinding先・データ状態は別途確認する。

### 保存・上限・バックアップ仕様

- サイト情報JSON：30,000文字以内。
- お知らせ：最大2,000件、JSON 10MB以内。
- 公開APIは公開指定の記事だけを日付順で最大2,000件返す。
- 画像：JPEG/PNG/WebP、1枚1.5MBまで。
- 役員・サイト管理者：各最大3名。
- 予定の各配列：最大12行。
- 保存前のスナップショット：90日間保持、各種類の直近20件を保持する実装。
- revisionが一致しない古い画面からの保存は409 conflictで拒否する。
- KVには完全な原子的compare-and-swapがないため、複数人で同時編集しない。編集担当を原則1人にする。
- バックアップには画像や部員情報が含まれる可能性がある。安全なアクセス制限付き保管場所に置き、公開リポジトリ・公開共有リンクへ置かない。

## 7. 公開データのプライバシー

公開API `/api/public/site-content` は、保存データ全体をそのまま返さず、許可された項目だけを組み立てて返す設計。将来の内部項目を自動公開しないこと。

公開前に確認すること：

- 部員本人が公開に同意した写真・紹介だけか。
- メールアドレスは公開用として適切か。
- 非公開の住所・電話番号・個人連絡先が含まれていないか。
- 画像に位置情報等のメタデータが残っていないか。
- 役員交代後の旧担当者情報が残っていないか。
- バックアップファイルに非公開情報が含まれていないか。

管理画面からの画像アップロードはブラウザで再エンコードし、通常のEXIF等のメタデータを引き継がない仕様。ただし既存の静的画像は別管理なので、個別確認する。

## 8. 品質検査・SEO

### GitHub Actions

`.github/workflows/site-quality.yml` を確認済み。

- Pull Requestでmainを対象とした場合に実行。
- mainへのpush時にも実行。
- `workflow_dispatch` で手動実行可能。
- Node.js 22を使用。
- `node scripts/site-audit.mjs` を実行。
- ジョブ名：`site-audit`

READMEでは、サイトマップ、HTML参照、OGP、画像alt、JavaScript構文等の検査を案内している。検査項目の詳細は `scripts/site-audit.mjs` の現行コードで確認する。

### Search Console・サイトマップ

`admin/SETUP.md` に記載されている公開サイトURL：

`https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/sitemap.xml`

Search ConsoleはURLプレフィックスプロパティをプロジェクトサイトの完全URLに合わせて使用する。

- サイトマップURLをブラウザで開き、HTTP 200とXML内容を確認。
- Search ConsoleのプロパティURLが一致しているか確認。
- 「取得できませんでした」の原因をrobots.txtだけに決めつけない。
- GitHub Pagesのプロジェクトサイトでは、リポジトリ内のrobots.txtはホスト直下ではなくプロジェクトパス配下になる点に注意。
- 現在のSearch Console登録・インデックス状況は要実機確認。

## 9. トラブルシューティング

### A. 管理画面にログインできない

1. 管理画面URLが `/admin/index.html` であることを確認。
2. ログイン画面から再ログインする。
3. セッション期限（8時間）切れの可能性を確認。
4. Workerの稼働状況とURLを確認。
5. Worker Secrets（ADMIN_PASSWORD、SESSION_SECRET）とKV binding（LOGIN_LIMITS）の設定を確認。
6. ログイン試行制限（15分・最大5回）に達していないか確認。
7. ブラウザの開発者ツールを使う場合は、トークンや秘密値をコピー・共有しない。

### B. 保存できない／revision conflict

1. 入力内容は消さず、ページを閉じない。
2. 別タブ・別担当者が先に保存していないか確認。
3. 保存済みデータを最新状態で読み込み、必要な差分を反映する。
4. 競合が解消してから再保存する。
5. 何度も連続で保存しない。必要ならバックアップを取得する。

### C. 保存したのに公開ページへ反映されない

1. 管理画面に保存成功が表示されたか確認。
2. 公開API `/api/public/site-content` または `/api/public/announcements` の応答を確認。
3. 公開ページが該当APIを読み込んでいるか確認。
4. ブラウザキャッシュ（公開APIは60秒キャッシュ指定の箇所あり）を考慮する。
5. WorkerとPagesのどちらに変更が必要か切り分ける。
6. 公開APIの応答に個人情報が過剰に含まれていないか確認する。

### D. 役員・お問い合わせ先が消えた／古い

1. 管理画面 `site-content.html#contacts` で保存済みデータを読み込む。
2. `contacts.people`、`contacts.peopleConfigured`、`contacts.siteAdmins` を確認。
3. KVにデータがあるか管理APIで確認（認証が必要）。
4. 公開API `/api/public/site-content` のcontactsを確認。
5. `contact/index.html` の静的な既定表示と、API取得後の置換処理を確認。
6. `peopleConfigured=true` で空配列の場合、既定の役員表示へ戻らない仕様を確認。
7. 不明な役員情報を推測で追加しない。バックアップまたは現役担当者の確認済み情報から復旧する。

### E. 画像が表示されない

1. URLのHTTPS・ファイル名・参照先を確認。
2. `/media/{id}` のIDとKVの保存データを確認。
3. 画像削除を行った場合は、活動写真・お知らせ等の参照も確認。
4. 旧画像のTTL切れがないか確認。必要なら管理画面の「既存画像の保存期限を延長」を検討。
5. 静的画像とWorkerのKV画像を混同しない。
6. 画像を削除する前にバックアップを取る。

### F. GitHub Pagesに変更が反映されない

1. 修正したブランチがmainに取り込まれているか確認。
2. ActionsのPages build and deploymentが成功しているか確認。
3. 公開URLと対象パスが正しいか確認。
4. キャッシュを考慮し、別ブラウザ・プライベートウィンドウでも確認。
5. Workerの変更はPagesの再デプロイだけでは反映されない点に注意。

### G. Search Consoleでサイトマップを取得できない

1. 公開サイトマップURLがブラウザで開くか確認。
2. XMLとして正しく出力されているか確認。
3. Search ConsoleのURLプレフィックスがプロジェクトサイトURLと一致しているか確認。
4. サイトマップ欄へ完全URLを送信しているか確認。
5. robots.txtの配置と役割を切り分ける。
6. 原因が確定する前に設定を大きく変更しない。

## 10. 定期点検チェックリスト

### 毎週

- [ ] トップページが表示される
- [ ] 活動紹介ページが表示される
- [ ] 部員・パート紹介が表示される
- [ ] 年間予定・イベント・お知らせが表示される
- [ ] お問い合わせページとフォームが開く
- [ ] 役員・問い合わせ先が現行情報である
- [ ] 主要画像・動画・SNSリンクが機能する
- [ ] スマートフォンでナビゲーションが操作できる
- [ ] 管理画面のログインができる
- [ ] 管理データの読み込み・保存ができる（本番データを変更するテストは避け、必要なら安全なテスト項目で実施）
- [ ] GitHub Actionsに失敗がない
- [ ] 新しいエラーや表示崩れがない

### 月次・年度更新時

- [ ] バックアップJSONを安全な場所に保存
- [ ] バックアップが復元可能な形式であることを確認
- [ ] 役員・サイト管理者・連絡先を確認
- [ ] 部員紹介・写真の公開同意を確認
- [ ] 管理者の交代・アクセス権を確認
- [ ] 年度共通パスワードとSESSION_SECRETの更新を検討
- [ ] Search Console・サイトマップの状況を確認
- [ ] 古いお知らせ・年度情報の表示を確認

## 11. 安全な修正・リリース手順

1. 対象リポジトリ・ブランチ・最新コミットを確認。
2. 変更対象ファイルと依存するAPI・ページを確認。
3. KVデータに影響する変更なら、先にバックアップを取得。
4. 作業ブランチを作成し、変更を限定する。
5. `scripts/site-audit.mjs` とGitHub Actionsを通す。
6. Pull Requestで差分を確認。
7. mainへマージ。
8. PagesのActions成功を確認。
9. Worker変更がある場合はCloudflare Dashboardから別途デプロイ。
10. 公開ページ・管理画面・APIの実動作を確認。
11. 変更内容、コミット、確認結果、未解決事項を記録。

データ形式変更・KVキー変更・画像削除・認証変更は影響が大きい。単純なHTML/CSS修正と同じ扱いにしない。

## 12. 2026-11-12時点の確認結果と未確認事項

### GitHub上で確認できたこと

- mainがデフォルトブランチ。
- 公開用READMEにPRベースの運用が記載されている。
- 管理ダッシュボードに「役員・お問い合わせ先」の編集画面へのリンクが存在する。
- サイト情報管理画面に役員・サイト管理者の編集欄が存在する。
- Workerにsite-content管理APIと公開APIが存在する。
- お知らせ管理API、画像管理API、バックアップAPIが存在する。
- お問い合わせページに公開APIから役員・SNSを取得する処理が存在する。
- GitHub Actionsにsite-auditが存在する。
- admin/SETUP.mdにCloudflare、バックアップ、Search Consoleの手順が記載されている。

### 本番環境で未確認のこと

- Cloudflare Workerがmainの `admin/worker.js` と同じコードでデプロイされているか。
- KV本番データに現行の役員・サイト管理者情報が保存されているか。
- 本番公開ページで役員情報が正常に表示されるか。
- 画像データのTTL延長がすべて完了しているか。
- GitHubのmainブランチ保護が有効か。
- Search Consoleの現在のサイトマップ取得・インデックス状態。
- 全ページのスマートフォン表示・リンク・画像・JavaScript動作。
- すべての既存修正ブランチがmainへ反映済みか。

### 次に行うべき作業

1. Cloudflare本番Workerのデプロイ内容と設定を照合する。
2. 管理画面から現行のsite-content・役員情報を読み込み、バックアップを取得する。
3. 公開APIのcontactsと公開お問い合わせページを照合する。
4. mainに未反映の修正ブランチを比較し、必要な変更だけPRで取り込む。
5. 全ページの実機・スマートフォン点検を行う。
6. Search Consoleとサイトマップを再確認する。
7. 実際に確認できた結果でこの文書を更新する。

---

## 13. 参照先

- GitHubリポジトリ： https://github.com/hamosositeMeiji/Meiji-HarmonicaSociety-website
- 公開サイト： https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/
- 管理画面： https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/admin/index.html
- 管理画面設定手順： `admin/SETUP.md`
- Workerソース： `admin/worker.js`
- 品質検査： `.github/workflows/site-quality.yml`、`scripts/site-audit.mjs`

**この文書は現行コードを調べるための入口であり、実際の本番状態を保証するものではない。作業開始時には必ずGitHubとCloudflareの最新状態を確認すること。**
