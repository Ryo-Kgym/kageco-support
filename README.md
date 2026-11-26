# Kageco 年間収支予測

個人事業主の2026年分を対象に、freee会計の実績と入力した前提から事業収入、経費、ふるさと納税、所得税、消費税を試算します。

## ローカル開発

Node.js 24で次を実行し、[ローカル画面](http://127.0.0.1:3000/)を開きます。「サンプルを見る」から架空データで予測と入力の保存を確認できます。ローカルの保存先は `.data/postgres` です。

```sh
npm ci
npm run dev
```

### freee会計を接続する

1. freeeアプリストアで事業所に紐づくOAuthアプリを作成し、事業所、仕訳帳、勘定科目、税区分の参照権限を設定します。コールバックURLは `http://127.0.0.1:3000/freee/callback` です。
2. `.env.example` を `.env.local` にコピーし、`FREEE_CLIENT_ID`、`FREEE_CLIENT_SECRET`、`FREEE_TOKEN_KEY` を設定します。トークンの暗号鍵は `node -p "require('node:crypto').randomBytes(32).toString('base64url')"` で生成できます。
3. 開発サーバーを再起動し、「freeeに接続」で対象の個人事業所を選びます。「接続を完了」の後、「freeeから同期」を押します。

締め済みの月は同期が月末まで到達している範囲で選べます。未確定月は利用できる直近3か月の締め済み実績から見積もります。月別の手入力は月全体の着地額です。勤務先の給与・賞与、寄附、控除、適用する消費税の申告方式は年の前提に入力します。

試算の対象は単一事業所です。消費税は通年で同じ申告方式を使い、簡易課税では1つの事業区分を扱います。一般課税で配分後の控除額を仕訳から確定できない場合は未算出になります。所得税・ふるさと納税は給与所得と事業所得を対象にしています。

## Vercelでの環境変数

`DATABASE_URL` にはマネージドPostgreSQLの接続URL、`APP_ORIGIN` には固定のHTTPSオリジンを設定します。freee側に登録するコールバックURLはそのオリジンの `/freee/callback` です。

`APP_PASSWORD` は24文字以上のランダムな値を使用します。`SESSION_SECRET` と `FREEE_TOKEN_KEY` はそれぞれ独立した32バイトのbase64urlキーを生成し、freeeのClient ID・SecretとともにVercelの環境変数に設定します。

## 検証コマンド

```sh
npm run typecheck
npm test
npm run build
```
