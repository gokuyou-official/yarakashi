# ロールバック手順

## バージョンタグ

- **`v1.0-pre-supabase`**: Supabase移行前の安定版（localStorage動作のみ）
  - コミット: `058c150` - "Step 1: Remove debug panel and fix trainSet reload bug"
  - 状態: ログイン機能なし、localStorageのみで動作

## ロールバック方法

Supabase移行で問題が発生した場合、以下のいずれかで戻せる。

### A. mainを直接戻す（破壊的・要注意）

```bash
git checkout main
git reset --hard v1.0-pre-supabase
git push --force origin main
```

> ⚠️ force pushなので、移行後に追加された他の作業も巻き戻る。実行前に確認すること。

### B. 戻し用ブランチを切る（安全）

```bash
git checkout -b rollback-from-supabase v1.0-pre-supabase
git push -u origin rollback-from-supabase
```

その後、Netlifyのデプロイブランチを `main` → `rollback-from-supabase` に切り替えるか、PRでmainにマージ。

### C. revertコミットで履歴を残しつつ戻す

```bash
git checkout main
git revert <Supabase移行コミットの範囲>
git push origin main
```

## データ救済

Supabase移行後にlocalStorageが消えていた場合：
- iPhoneのSafari履歴・ストレージは過去データを保持していない可能性が高い
- 移行ステップ5（既存ユーザー救済）でlocalStorage→Supabase一括移行を実装済みなので、移行ボタンを押す前にrollbackすればlocalStorageは残る

## 各ステップ完了時のタグ目安

| タグ | 内容 |
|---|---|
| `v1.0-pre-supabase` | localStorageのみ（現在） |
| `v2.0-supabase-auth` | Magic Link認証実装後 |
| `v2.1-supabase-data` | データ層Supabase化後 |
| `v2.2-migration` | 移行UI追加後 |
