# ハモソ管理画面：認証APIの設定手順

## 目的と現在の範囲
このWorkerは年度共通パスワードをサーバー側で照合し、署名付きセッショントークンを発行します。ログイン試行はIPごとに15分で最大5回までに制限します。お知らせ・演奏会情報、画像アップロード、サイト情報（活動紹介・写真URL・動画URL・SNS・入会案内・活動予定）の管理APIを含みます。

## Cloudflare側の設定（ブラウザのみ）
1. Cloudflareアカウントを作成し、Workers & Pagesから新しいWorkerを作成します。
2. このリポジトリの `admin/worker.js` の内容をWorkerのコードエディターに貼り付けて保存・デプロイします。
3. WorkerのSettings / Bindingsで、KV namespaceを作成し、変数名 `LOGIN_LIMITS` でバインドします。
4. WorkerのSettings / Variables and Secretsで、次の2つを **Secret** として登録します（通常のText変数ではなくSecret）。
   - `ADMIN_PASSWORD`: 年度用の強いパスワード。長くランダムなもの（推奨20文字以上）にし、チャットやリポジトリに書かないでください。
   - `SESSION_SECRET`: 別のランダムな秘密値。少なくとも32文字。年度更新時はこれも変更して旧セッションを無効化します。
5. WorkerのURL（例：`https://任意の名前.あなたのサブドメイン.workers.dev`）を控えます。実際のURLはCloudflareが発行したものを使います。

## 年度更新
1. 新年度用の `ADMIN_PASSWORD` と `SESSION_SECRET` をWorkerのSecretsで更新します。
2. これにより旧パスワードでの新規ログインが拒否され、旧セッションも無効になります。
3. 新パスワードは別経路で現役運営メンバーに共有し、退任者に共有しないでください。

## 注意
- Workerのソースコードは公開リポジトリに置いても構いませんが、パスワード、セッション秘密値、APIトークンは絶対に書き込まないでください。
- `admin/worker.js` を更新した場合は、Cloudflare DashboardからWorkerのコードを最新内容に置き換えて再デプロイしてください。GitHubへのコミットだけではCloudflare上のWorkerは更新されません。
- `admin/site-content.html` で保存した活動紹介・写真URL・動画URL・SNS・入会案内・活動予定は、KVの管理用領域に保存されます。現時点では公開サイトへの自動反映は未実装です。公開サイト側の表示連携と公開前プレビューは次の実装段階です。
- 問い合わせ内容の受信・閲覧機能は未実装です。
- Cloudflareの無料枠・仕様は変更されることがあります。最新の制限は公式ドキュメントを確認してください。
