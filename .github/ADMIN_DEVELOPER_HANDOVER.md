# 管理画面・開発保守 引き継ぎ書

> 対象：サイト保守担当者・次年度以降の開発担当者  
> この文書は開発・運用者向けです。公開サイトの利用者向け案内には掲載しません。  
> 更新日：2026-11-13

## 1. 全体構成

このサイトは、公開画面と管理画面で公開・保存の仕組みが分かれています。

| 領域 | 役割 | 主な場所 |
|---|---|---|
| 公開サイト | GitHub Pagesで配信するHTML/CSS/JavaScript | リポジトリ直下、`activities/`、`events/`、`parts/`、`schedule/`、`news/` |
| 管理画面 | 運営者がサイト情報・写真・お知らせを編集 | `admin/*.html` |
| API | ログイン、保存、画像、バックアップ | `admin/worker.js` |
| 永続データ | サイト情報・お知らせ・画像・セッション | Cloudflare KV（Worker binding `LOGIN_LIMITS`） |
| 品質検査 | サイトマップ、リンク、HTML内スクリプト、JavaScript構文など | `scripts/site-audit.mjs`、`.github/workflows/site-quality.yml` |

GitHub PagesとCloudflare Workerは別々にデプロイされます。GitHubの変更が成功しても、Workerのコードが自動更新されたとは限りません。

## 2. 本番環境・ブランチ

- リポジトリ：`hamosositeMeiji/Meiji-HarmonicaSociety-website`
- 本番ブランチ：`main`
- 公開サイト：`https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/`
- 管理画面：`https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/admin/index.html`
- Worker：`hamoso-admin-auth.hamososaitoguanli.workers.dev`

作業は必ず作業ブランチで行い、Pull Requestと自動検査を通してからmainへ反映します。Draft PRは本番反映済みではありません。

## 3. どこを見ればよいか（障害別）

| 症状 | 最初に確認する場所 | 次に確認すること |
|---|---|---|
| 管理画面が開かない | `admin/index.html`、GitHub PagesのActions | Pagesのビルド・公開状態、URLのパス |
| ログインできない | `admin/login.html`、`admin/worker.js` の `/api/login` | Workerの稼働、Secret、KV binding、ログイン試行制限 |
| ログイン直後に戻される | `admin/worker.js` の `/api/session` と `validSession()` | セッション期限、KVの `session:` キー、端末のsessionStorage |
| 保存できない | 該当する管理画面HTML、Workerの保存API | ブラウザの開発者ツール、Workerログ、revision conflict |
| 保存したのに公開表示が変わらない | `/api/public/site-content`、`/api/public/announcements`、公開側の表示スクリプト | KVに保存された値、公開APIの応答、キャッシュ |
| 写真が表示されない | `admin/image-tools.js`、`admin/worker.js` の `/media/` | 画像URL、KVの `media:` キー、WorkerのContent-Type |
| 写真を削除したら他の場所から消えた | Workerの `/api/media/:id` DELETE | 共有画像を削除していないか、参照先の確認 |
| バックアップを作れない | `admin/backup.html`、Workerの `/api/backup/*` | 画像件数・サイズ、通信タイムアウト、KV読み出し |
| サイトマップ・検索登録の問題 | `sitemap.xml`、`sitemap.txt`、`robots.txt`、`scripts/site-audit.mjs` | 公開URLのHTTP応答、Search ConsoleのプロパティとURL一致 |

### エラーコードの目安

- `401`：未認証、セッション期限切れ、認証情報不一致
- `403`：許可されていないOriginなど
- `404`：APIルート・画像ID・保存データが見つからない
- `409`：revision conflict、または参照中の画像を削除しようとした場合
- `413`：画像やデータが上限を超えた場合
- `429`：ログイン試行回数の上限
- `503`：WorkerのSecretまたはKV bindingが未設定

## 4. 管理画面ファイルの役割

- `admin/index.html`：管理画面トップ・各編集画面へのリンク
- `admin/login.html`：ログイン
- `admin/site-content.html`：活動紹介、写真、動画、SNS、入会案内、役員、サイト管理者、活動予定
- `admin/announcements.html`：お知らせ・演奏会情報
- `admin/backup.html`：バックアップの書き出し・復元
- `admin/image-tools.js`：画像のクライアント側処理（再エンコード等）
- `admin/worker.js`：API・認証・KV操作
- `admin/SETUP.md`：Cloudflareの設定と運用手順

管理画面のHTMLには検索エンジン向けの `noindex,nofollow` を設定します。管理画面のURLを知っていても、APIの認証を省略できるわけではありません。

## 5. Cloudflare Worker・KV

### 必要な環境設定

- Secret `ADMIN_PASSWORD`：初期ログインパスワード
- Secret `SESSION_SECRET`：セッション署名用の秘密値
- KV binding `LOGIN_LIMITS`：認証・コンテンツ・画像データの保存先

実際の値はGitHub、Pull Request、Issue、チャット、ソースコードに記載しないでください。設定方法や復旧の詳細は `admin/SETUP.md` を参照します。

### 主なKVキー

| キー・接頭辞 | 用途 |
|---|---|
| `content:site-content` | 活動紹介・写真URL・SNS・入会案内・予定・連絡先 |
| `content:announcements` | お知らせ一覧 |
| `revision:site-content` | サイト情報の更新番号 |
| `revision:announcements` | お知らせの更新番号 |
| `media:` | アップロード画像 |
| `session:` | 有効なログインセッション |
| `login:` | IP単位のログイン試行制限 |
| `backup:site-content:` | サイト情報の保存前スナップショット |
| `backup:announcements:` | お知らせの保存前スナップショット |

パスワード変更機能を反映した場合は、KVの `auth:password-hash` にPBKDF2ハッシュが保存されます。これはPR #53の追加仕様です。通常の年度更新でKVキーを手作業で編集しないでください。

### 主なAPIルート

| ルート | 用途 |
|---|---|
| `POST /api/login` | ログイン |
| `GET /api/session` | セッション確認 |
| `POST /api/logout` | ログアウト |
| `GET/POST /api/site-content` | サイト情報の取得・保存 |
| `GET/POST /api/announcements` | お知らせの取得・保存 |
| `GET /api/public/site-content` | 公開サイト向けサイト情報 |
| `GET /api/public/announcements` | 公開サイト向けお知らせ |
| `POST /api/media` | 画像アップロード |
| `GET /media/:id` | 公開画像の配信 |
| `DELETE /api/media/:id` | 画像削除と既知の掲載先の取り外し |
| `POST /api/media/extend-retention` | 旧画像の保存期限延長 |
| `GET /api/backup/export`、`GET /api/backup/export-media` | バックアップ書き出し |
| `POST /api/backup/restore-media`、`POST /api/backup/restore-content` | バックアップ復元 |
| `POST /api/backup/restore-latest-snapshot` | 保存前スナップショットから復元 |

PR #53では `POST /api/password/change`、PR #60では `GET /api/media/library` と `POST /api/media/delete-unused` を追加します。これらは各PRがmainに反映され、Workerも再デプロイされた後に利用できます。

## 6. データを壊さないための注意

1. 管理画面を変更する前に、バックアップJSONを取得します。
2. 実データを確認せずにKVキーを削除・上書きしません。
3. サイト情報とお知らせを複数人が同時編集しないよう、保存担当を決めます。revisionチェックはありますが、KVに原子的なcompare-and-swapはありません。
4. 画像は複数の場所で共有される可能性があります。完全削除の前に掲載先を確認します。
5. 画像の参照検出は管理用KV内のサイト情報・お知らせを対象とします。静的HTML、外部サービス、別システムの参照までは保証しません。
6. バックアップJSONには部員情報や画像が含まれる可能性があります。公開リポジトリや公開共有リンクに置きません。
7. 部員の氏名・連絡先・写真は、本人の公開同意が確認できたものだけを掲載します。

## 7. 変更・公開手順

### GitHub Pages側

1. 作業ブランチで変更します。
2. Pull Requestを作成します。
3. GitHub Actionsの `Site quality checks` が成功することを確認します。
4. 差分と変更対象ファイルを確認してからmainへ反映します。
5. Pagesのビルド・デプロイ完了後、公開URLをPCとスマートフォンで確認します。

### Cloudflare Worker側

1. Worker変更を含むPRがmainに反映されたことを確認します。
2. mainの `admin/worker.js` をCloudflare Dashboardの対象Workerへ反映します。
3. SecretとKV bindingが既存のままであることを確認します。値を再入力・変更する必要がない場合は触りません。
4. デプロイ後、ログイン、セッション確認、サイト情報の読み込み・保存、お知らせ、画像、バックアップを確認します。
5. Worker変更が失敗した場合は、Cloudflareの直前の正常なデプロイ版へ戻し、KVデータは削除しません。

GitHub PagesとWorkerの更新順序を混同しないでください。特にPR #53と#60はWorkerの再デプロイが必要です。

## 8. 検査コマンド

リポジトリのルートで実行します。

```bash
node scripts/site-audit.mjs
```

PR #53がmainに反映された後は、パスワード管理のWorkerモックテストも実行します。

```bash
node scripts/password-management-test.mjs
```

PR #60がmainに反映された後は、画像ライブラリのWorkerモックテストも実行します。

```bash
node scripts/media-library-test.mjs
```

CIの成功は静的検査・モック環境の検査結果です。本番Cloudflare KV、実際のログイン、iPhoneでの表示を保証するものではありません。

## 9. 旧CMS・旧データについて

- `admin/config.yml` は旧Decap CMS / Git Gateway用の設定で、現行管理画面では使いません。
- `content/site.json` は旧CMS時代の参考データで、現行サイトの保存先ではありません。
- 現行サイトの活動情報・予定・連絡先はCloudflare KVの `content:site-content` が保存先です。
- 旧CMS用ファイルを、現行データの保存先と誤認して編集・削除しないでください。

---
この文書は運用実態に合わせて更新してください。秘密値、個人の非公開連絡先、実データを含むバックアップは追記しないでください。
