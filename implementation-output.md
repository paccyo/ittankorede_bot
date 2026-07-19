実装完了しました。

主な内容:

- miseでNode.js / AWS CLIを固定
- Discord Botのローカル起動機能を追加
- Discord/AWS SSOのセットアップ手順を整備
- トークン検証・CDKテストを追加
- `.env` の秘密情報をGit管理対象外に設定
- [implementation-output.md](/home/runner/work/ittankorede_bot/ittankorede_bot/implementation-output.md) を更新

スモークテストと差分検査は成功しました。Jest/ビルドは、環境のネットワーク制限によりnpm依存関係を取得できず未実行です。