# 四平台音乐 Worker

支持酷我、QQ音乐、酷狗、网易云四个平台同时搜索，搜索结果带平台标签；收藏和自定义歌单使用 `platform + song_id` 区分歌曲。

## 搜索与播放

- 酷我、QQ音乐带内置搜索适配器。
- 酷我默认播放模板：`https://music.nxinxz.com/kw.php?id={id}&level={level}&type={type}`
- QQ默认播放模板：`https://music.nxinxz.com/kgqq/tx.php?id={id}&level={level}&type={type}`
- 酷狗、网易云需在“设置与个人音源”中添加搜索和播放接口。
- 每个平台可保存多条音源，并分别选择当前音源。

搜索接口模板支持 `{keyword}`、`{page}`、`{limit}`。接口需返回 JSON，歌曲数组可以直接作为根数组，或位于 `data`、`data.list`、`songs`、`result.songs`、`result`、`list`。常用字段会自动兼容：

- ID：`id` / `songId` / `songid` / `mid` / `songmid` / `rid`
- 标题：`title` / `name` / `songName` / `songname`
- 歌手：`artist` / `artists` / `singer` / `singers` / `author`
- 专辑：`album` / `albumName` / `albumname`
- 封面：`artwork` / `picUrl` / `cover` / `image` / `imgurl`

## 更新已部署项目

只覆盖：

- `public/index.html`
- `src/index.js`
- `migrations/0003_multiplatform.sql`

然后运行：

```bash
npm run db:migrate:remote
npm run deploy
```

迁移会保留旧数据，并把原收藏与歌单歌曲标记为 `kuwo`。

## 聚合接口自动识别（v4）

登录后打开“设置与个人音源”，在“聚合接口自动识别”中填写 HTTPS 聚合 API 地址并点击“检测并保存”。Worker 会：

- 针对酷我、QQ、酷狗、网易云尝试常见搜索参数格式；
- 自动识别歌曲数组路径及 ID、标题、歌手、专辑、封面字段；
- 使用搜索样本测试常见播放参数格式；
- 识别直返音频、302 跳转以及 JSON 中的播放链接；
- 只保存同时通过搜索和播放测试的平台；
- 为自动识别音源保存适配配置，之后无需重复探测。

升级旧数据库：

```bash
npm run db:migrate:remote
npm run deploy
```

本功能只允许 HTTPS，并阻止 localhost、回环地址及常见私网 IP。签名、加密、Cookie、特殊 POST 请求或多阶段解析接口仍可能需要手动适配。

## 当前整合版

此目录为功能整合版，部署说明见 `DEPLOY-IPAD.md`。当前 `wrangler.jsonc` 已绑定现有 D1 数据库 `kuolao-music-db`。
