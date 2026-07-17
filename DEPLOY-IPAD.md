# iPad / GitHub Codespaces 更新部署

此包已整合当前全部功能，并保留现有 Cloudflare D1 数据库绑定。

## 覆盖现有仓库

在 Codespaces 终端中，将 ZIP 解压到仓库根目录并覆盖文件：

```bash
unzip -o kuolao-music-all-in-one.zip
cp -r kuolao-music-all-in-one/* ./
cp kuolao-music-all-in-one/.gitignore ./ 2>/dev/null || true
```

## 安装依赖、迁移、部署

```bash
npm install
npm run db:migrate:remote
npm run deploy
```

如果迁移提示没有待执行项目，属于正常情况。

## 保存到 GitHub

```bash
git add .
git commit -m "Integrate all music features"
git push
```

## 已整合功能

- Cloudflare Workers Static Assets
- D1 用户注册、登录、退出及会话
- 管理员一次性初始化
- 用户收藏持久化、删除、清空、顺序播放、随机播放
- 用户个人音源 API 新增、编辑、选择和删除
- 自定义歌单新建、编辑、删除、加歌、移除、清空、顺序/随机播放
- 酷我、QQ、酷狗、网易云四平台并发搜索和平台标签/筛选
- 收藏及歌单按平台和歌曲 ID 隔离
- 聚合接口自动探测与字段映射
- 洛雪音源静态适配
- Huibq render_api.js 适配入口
- 原有歌词、封面、音质、播放进度和单曲下载
- 已删除顶部头像、顶部站名和默认宣传文案
- 浏览器标签标题改为“音乐播放器”

## 注意

远程洛雪脚本不会在 Worker 主环境中直接执行；适配器只提取可安全识别的接口配置。高度混淆、动态签名或依赖完整 LX 运行时的脚本仍可能无法导入。
