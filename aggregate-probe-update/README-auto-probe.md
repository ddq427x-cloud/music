# 聚合接口自动识别增量更新

1. 解压覆盖 `src/index.js`、`public/index.html` 并新增 `migrations/0004_source_autoprobe.sql`。
2. 执行 `npm run db:migrate:remote`。
3. 执行 `npm run deploy`。
4. 登录网站，进入设置，使用“聚合接口自动识别”。

此更新不会覆盖 `wrangler.jsonc`，不会改变现有 D1 database_id。
