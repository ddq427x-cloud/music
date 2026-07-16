# 裤佬音乐网（Cloudflare Workers + D1）

功能：

- 用户注册、登录、退出
- PBKDF2-SHA256 密码哈希；HttpOnly / Secure / SameSite=Lax 会话 Cookie
- 每个用户独立的收藏歌单，可删除单曲、清空、顺序播放、随机播放
- 每个用户独立的音源 API，可添加、编辑、选择、删除
- 使用 Worker 变量和 Secret 一次性初始化管理员账号
- Cloudflare Workers Static Assets 托管前端，D1 保存用户、会话、收藏及音源

## 快速部署

```bash
npm install
npx wrangler login
npx wrangler d1 create kuolao-music-db
```

将返回的 database_id 写入 wrangler.jsonc，然后：

```bash
npm run db:migrate:remote
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SETUP_TOKEN
npm run deploy
```

部署后初始化管理员：

```bash
curl -X POST "https://你的地址/api/setup/admin" \
  -H "Authorization: Bearer 你的ADMIN_SETUP_TOKEN"
```

成功后可以删除初始化 Secret：

```bash
npx wrangler secret delete ADMIN_PASSWORD
npx wrangler secret delete ADMIN_SETUP_TOKEN
```

注意：删除后，现有管理员仍可正常登录，因为密码哈希已经写入 D1。

## 本地开发

在项目根目录创建 `.dev.vars`：

```dotenv
ADMIN_PASSWORD=本地测试强密码
ADMIN_SETUP_TOKEN=本地初始化密钥
```

然后：

```bash
npm run db:migrate:local
npm run dev
```

## 音源 URL 模板

必须使用 HTTPS，并至少包含 `{id}`。支持 `{id}`、`{level}`、`{type}`。

示例：

```text
https://example.com/music?id={id}&level={level}&type={type}
```
