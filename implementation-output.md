実装しました。

変更内容:
- [package.json](/home/runner/work/ittankorede_bot/ittankorede_bot/package.json:1) に CDK/Jest/TypeScript/tweetnacl 依存と scripts を追加
- [bin/app.ts](/home/runner/work/ittankorede_bot/ittankorede_bot/bin/app.ts:1) と [lib/discord-bot-stack.ts](/home/runner/work/ittankorede_bot/ittankorede_bot/lib/discord-bot-stack.ts:1) に CDK 構成を追加
  - Node.js 20.x の `NodejsFunction`
  - `src/bot.ts` / `handler`
  - API Gateway REST API `POST /interactions`
  - Lambda proxy integration
  - `PUBLIC_KEY` 環境変数
- [src/bot.ts](/home/runner/work/ittankorede_bot/ittankorede_bot/src/bot.ts:1) に Discord 署名検証と Ping 応答を実装
- [test/bot.test.ts](/home/runner/work/ittankorede_bot/ittankorede_bot/test/bot.test.ts:1) に Jest 単体テストを追加
- [.gitignore](/home/runner/work/ittankorede_bot/ittankorede_bot/.gitignore:17) で CDK 用 `lib/**/*.ts` を追跡できるよう調整

確認:
- `python -m unittest discover`: 成功
- `npm install --fetch-timeout=10000 --fetch-retries=0`: 失敗。`registry.npmjs.org` の DNS 解決が `EAI_AGAIN`
- 依存未取得のため `npm test` は `jest: not found`、`npm run synth` は `cdk: not found`、`npm run build` は `@types/*` 不足で失敗

ネットワーク復旧後は `npm install` の後に `npm test` と `npm run synth` を実行すれば検証できます。