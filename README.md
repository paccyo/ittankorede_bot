# ittankorede_bot

Discord Bot と AWS CDK の開発リポジトリです。mise により、全開発者が同じ Node.js / AWS CLI を利用できます。

## 初回セットアップ

### 1. mise をインストールする

[mise の公式手順](https://mise.jdx.dev/getting-started.html)でインストール後、リポジトリ直下で次を実行します。

```sh
mise trust
mise install
mise run setup
```

`mise install` は `mise.toml` に固定された Node.js と AWS CLI v2 を導入します。

### 2. Discord Bot のトークンを取得する

1. [Discord Developer Portal](https://discord.com/developers/applications) で Application を作成する
2. `Bot` → `Add Bot` を選び、`Reset Token` からトークンを取得する
3. `OAuth2` → `URL Generator` で `bot` scope を選び、`Manage Channels`、`View Channels`、`Send Messages`、`Read Message History` 権限を付けて確認用サーバーへ招待する
4. `.env.example` を `.env` にコピーし、取得した値を設定する

```sh
cp .env.example .env
```

`.env` の `DISCORD_GUILD_ID` には操作対象サーバーのID、`DISCORD_SETUP_CHANNEL_ID` には常設ボタンを投稿する専用チャンネルのIDを設定します。サーバーには「ゲーム」と「アーカイブ」というカテゴリをあらかじめ作成してください。Bot起動時に常設ボタンと、送信不可に設定されたアーカイブ用モックチャンネル5件が不足分だけ作成されます。

トークンはパスワードと同じ機密情報です。`.env` はGit管理対象外です。漏えいした場合はDeveloper Portalですぐに再発行してください。

### 3. Bot を起動する

```sh
mise run bot
```

`Discord bot is online as ...` と表示され、Discord上のBotがオンラインになれば動作確認完了です。終了は `Ctrl+C` です。特権Intentは使用しません。

## AWS CLI ログイン

このプロジェクトでは AWS IAM Identity Center (SSO) を利用します。管理者から発行されたStart URL、SSO Region、Account、Roleを使って初回設定します。

```sh
mise exec -- aws configure sso
```

以降は、作成したprofile名を指定してログイン・確認できます。

```sh
AWS_PROFILE=your-profile mise run aws-login
# aws-login already runs: aws sts get-caller-identity
```

`AWS_PROFILE` を省略した場合はdefault profileを利用します。アクセスキーやSSOキャッシュなどの認証情報はコミットしないでください。

## 開発コマンド

```sh
mise run test
mise run build
```

CDKコマンドは `discord-bot-cdk` ディレクトリで実行します。詳細は [discord-bot-cdk/README.md](discord-bot-cdk/README.md) を参照してください。
