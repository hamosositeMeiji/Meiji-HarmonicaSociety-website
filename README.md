# 明治大学ハーモニカソサエティー 公式サイト

公開サイト: https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/

このリポジトリは、明治大学ハーモニカソサエティー（ハモソ）の公式Webサイトです。

## 開発・公開の流れ

- 公開対象ブランチは `main` です。
- 変更は作業ブランチで行い、Pull Requestで確認してから `main` に反映します。
- GitHub Pagesは `main` の更新後に自動ビルド・公開されます。反映後はActionsのPages build and deploymentが成功したことを確認してください。
- `.github/workflows/site-quality.yml` はPull Requestとmainへのpush時に、サイトマップ、HTML参照、OGP、画像alt、JavaScript構文などを検査します。

## 管理画面・データ保存

- 管理画面: https://hamosositemeiji.github.io/Meiji-HarmonicaSociety-website/admin/index.html
- 管理画面のログイン・コンテンツAPIはCloudflare Workerを使用します。
- 活動紹介・写真・動画・SNS・入会案内・スケジュール・役員情報・お知らせはCloudflare KVに保存されます。
- GitHub PagesとCloudflare Workerは別々にデプロイされます。Workerの変更はCloudflare Dashboardから `admin/worker.js` を手動デプロイしてください。
- バックアップは管理画面の「データのバックアップ・復元」からJSONでダウンロードできます。画像や役員情報を含む場合があるため、公開リポジトリや公開リンクには保存しないでください。

## 主なディレクトリ

| パス | 役割 |
|---|---|
| `admin/` | 管理画面、Worker、運用手順 |
| `activities/` | 活動紹介 |
| `contact/` | お問い合わせ |
| `events/` | 演奏会・イベント |
| `parts/` | パート紹介 |
| `schedule/` | 年間スケジュール |
| `news/` | お知らせ・年度別アーカイブ |
| `shared/` | 共通UI・アクセシビリティ関連 |
| `scripts/` | リポジトリ検査スクリプト |
| `content/` | 旧CMS時代の参考データ。現行サイトの保存先ではありません |

## 安全に関するルール

- 部員紹介は本人が公開に同意した情報・写真だけを掲載してください。
- パスワード、セッション秘密値、APIトークンをHTML・JavaScript・Markdown・Issue・Pull Requestに書かないでください。
- 個人の住所、電話番号、非公開の連絡先、同意のない写真をリポジトリに追加しないでください。
- 写真の削除は管理画面から行い、参照先の表示も確認してください。
- `main`への直接pushは避け、Pull Requestと自動検査を通してください。

## 詳細な運用手順

Cloudflare Workerの設定、KV、画像の保存・削除、バックアップ、Search Console、ブランチ保護の手順は [admin/SETUP.md](admin/SETUP.md) を参照してください。
