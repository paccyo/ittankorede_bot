実装完了しました。

主な対応:

- Gemini構造化出力による表記揺れ判定
- 類似アーカイブチャンネルのリンク表示
- エフェメラル三択ボタン
- 新規作成・既存復元・キャンセル処理
- Gemini API障害時のフォールバック
- 関連テスト追加
- [.env.example](/home/runner/work/ittankorede_bot/ittankorede_bot/.env.example) にGemini設定追加
- [implementation-output.md](/home/runner/work/ittankorede_bot/ittankorede_bot/implementation-output.md) 更新

主要実装の厳格型チェックと`git diff --check`は成功しました。全Jestテストは、npm registryへの接続エラーで依存関係を復元できず未実行です。