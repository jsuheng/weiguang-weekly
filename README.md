# 周报 · 运营协作中心

公司内网使用的多人协作周报系统，包含账号数据导入与审核、团队周报、任务分派、内部账号管理、站内提醒和操作审计。

## 系统架构

- 前端与 API：Next.js 16、React 19、TypeScript；
- 数据库：PostgreSQL；
- 文件存储：公司服务器持久目录 `/data/weiguang/files`；
- 登录：内部用户名和密码，首次登录强制改密；
- 权限：Leader 与实习生使用同一个域名，服务端按小组成员关系授权；
- 定时提醒：Docker 内部调度服务每 10 分钟检查任务和周报。

系统不开放自助注册，不使用手机号、外部授权或外部消息渠道。

## 本地开发

需要 Node.js `>=22.13.0` 和 pnpm。本地预览可使用内置 PGlite 与本地文件目录；生产环境使用 PostgreSQL 和服务器持久目录。

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm db:migrate
printf '%s' 'Temporary-Password-2026' | pnpm account:bootstrap-leader -- \
  --username leader --display-name Leader --group-name 内容增长组 --password-stdin
pnpm dev -- --port 3001
```

本地演示角色入口仅用于开发数据库：

- `http://localhost:3001/?role=leader`
- `http://localhost:3001/?role=intern`

生产环境的演示接口会返回 404，不能通过网址参数切换角色。

## Docker 内网部署

```bash
cp .env.example .env
# 填写真实配置
bash scripts/preflight.sh
docker compose --env-file .env up -d --build
bash scripts/bootstrap-leader.sh leader "Leader" "内容增长组"
```

网站统一从 `http://服务器内网IP:7019` 访问；正式使用建议由 Caddy 配置公司内网 HTTPS 域名。

完整说明见 `docs/运维部署交接手册.md`。
