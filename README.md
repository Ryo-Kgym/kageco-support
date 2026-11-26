# 年間収支・税額試算

個人事業主の2026年分を対象に、freee会計の実績と入力した前提から事業収入、経費、ふるさと納税、所得税、消費税を試算します。

## ローカル開発

Node.js 24で次を実行し、[ローカル画面](http://127.0.0.1:3000/)を開きます。実績と入力値はログインセッションごとにサーバーのメモリに保持します。ログアウトやサーバープロセスの再起動後は実績を同期し直してください。

```sh
npm ci
npm run dev
```

### freeeでログインする

1. freeeアプリストアで事業所に紐づくOAuthアプリを作成し、事業所、仕訳帳、勘定科目、税区分の参照権限を設定します。コールバックURLは `http://127.0.0.1:3000/freee/callback` です。
2. `.env.example` を参考に、Gitの管理対象外の `.env.local` に `FREEE_CLIENT_ID`、`FREEE_CLIENT_SECRET`、`SESSION_SECRET` を設定します。`SESSION_SECRET` は `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'` で生成できます。
3. 「freeeでログイン」を押し、freeeで対象の個人事業所を選んで参照を許可します。「ログインを完了」の後、「freeeから同期」を押します。

ログインと認可の情報は暗号化したCookieに保持します。別のブラウザや別のログインセッションから、取り込んだ実績や入力値は参照できません。

締め済みの月は同期が月末まで到達している範囲で選べます。未確定月は利用できる直近3か月の締め済み実績から見積もります。月別の手入力は月全体の着地額です。勤務先の給与・賞与、寄附、控除、適用する消費税の申告方式は年の前提に入力します。

試算の対象は単一事業所です。消費税は通年で同じ申告方式を使い、簡易課税では1つの事業区分を扱います。一般課税で配分後の控除額を仕訳から確定できない場合は未算出になります。所得税・ふるさと納税は給与所得と事業所得を対象にしています。

### Vercelにデプロイする

Node.js 24を選び、Productionの `APP_ORIGIN` に本番オリジンを末尾の `/` なしで設定します。`FREEE_CLIENT_ID`、`FREEE_CLIENT_SECRET`、`SESSION_SECRET` はProductionのSecretに設定し、freeeのOAuthアプリに本番オリジンの `/freee/callback` を登録します。Vercelの実行インスタンスが切り替わると、同期結果や予測の入力をやり直す場合があります。

## 検証コマンド

```sh
npm run typecheck
npm test
npm run build
```
