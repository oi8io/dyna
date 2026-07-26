# Dyna Studio

Dyna Studio 是一个 Web 作品生成器：用户登录后，用一句话生成真实的 React/TypeScript 工程，立即试玩、继续对话修改，并发布公开链接。首个品类是网页小游戏，后续会扩展到海报、动画、短剧和网页。

默认使用零成本 `fake` 模式。它仍会创建项目、保存多文件源码、生成版本、运行安全校验、展示可玩产物并发布快照。切换到 `live` 后，同一链路会调用 DeepSeek 并真实构建源码。

## 已实现

- Google OAuth 与邮箱 Magic Link 登录入口
- Supabase 项目、消息、源码、版本、用量和发布快照模型
- RLS 所有权隔离
- 一句话创建、自然语言修改和失败恢复
- 两阶段生成：先出计划，需求含糊时停下来问（不消耗额度），确认后才写代码
- `SPEC.md` 记录作品意图与已做决定，随版本、发布和 Remix 传递
- 编辑只重写改动的文件，构建失败自动带着编译错误重试一次
- React/TypeScript 多文件模板与只读源码浏览
- Fake/DeepSeek Provider Adapter
- 进程内 esbuild 构建器（Vercel 上可选 Sandbox microVM）
- 文件白名单、路径穿越防护、体积和远程资源限制
- 原子额度预占、幂等、全局预算、并发和速率限制
- `iframe sandbox="allow-scripts"` 隔离预览
- CSP、日志脱敏和开放重定向防护
- 不可变公开试玩链接（发布后永久有效）
- 首页画廊只展示已发布作品；未发布的项目完全私有
- 已发布作品的只读源码浏览与一键 Remix，Remix 复制的是发布时的快照
- 发布时可选择是否允许别人查看源码并 Remix，事后可随时收回

## 技术栈

Next.js 16、React 19、TypeScript、Tailwind CSS 4、shadcn 风格组件、shiki、Supabase、DeepSeek、Vitest 和 esbuild，部署在 Railway 的常驻 Node 进程上。

生成过程通过 SSE 实时推送：模型每写出一段代码，Builder 的只读编辑器就同步显示，并自动切到正在写的文件。

## 本地启动

要求 Node.js 22+ 和 pnpm 9+。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开 `http://localhost:3000`。所有变量记录在 `.env.example`；真实密钥只放 `.env.local` 或部署平台的服务端环境变量。

## Supabase 初始化

Schema 位于 `supabase/migrations/`：`202607240001_initial_schema.sql` 建基础模型，`202607250001_visibility_and_remix.sql` 加可见性、画廊与 Remix，`202607250002_remix_carries_spec.sql` 让 Remix 继承发布快照中的作品意图。

```bash
pnpm dlx supabase link --project-ref <project-ref>
pnpm dlx supabase db push --dry-run
pnpm dlx supabase db push
```

迁移后，在 SQL Editor 设置已经确认的额度。下列占位符必须替换：

```sql
update public.app_budget
set
  generation_enabled = true,
  cap_usd = <PUBLIC_BUDGET_USD>,
  default_create_credits = <CREATE_LIMIT>,
  default_edit_credits = <EDIT_LIMIT>
where singleton = true;
```

环境变量中的 `APP_PUBLIC_BUDGET_USD`、`APP_NEW_USER_CREATE_LIMIT`、`APP_NEW_USER_EDIT_LIMIT` 应使用相同值。Google 登录还需在 Supabase Auth Providers 中配置 OAuth Client，并把本地和生产地址的 `/auth/callback` 加入 Redirect URL。

## 生成模式

安全默认值：

```text
AI_PROVIDER_MODE=fake
APP_GENERATION_ENABLED=false
```

Live 模式只有同时满足以下条件才会启用：

- `AI_PROVIDER_MODE=live` 与 `APP_GENERATION_ENABLED=true`
- 三个预算／额度环境变量均为正数
- DeepSeek Key 已配置
- 数据库 `app_budget.generation_enabled=true`

构建器由 `BUILD_EXECUTOR` 指定：`local` 用进程内 esbuild（任何主机可用），`sandbox` 用 Vercel microVM（仅 Vercel）。

## 安全模型

- Agent 只能写 `src/App.tsx`、`src/styles.css`、`src/game/**`、`src/components/game/**` 和 `README.md`。
- 依赖、入口、构建脚本、CSP 和 TypeScript 配置由平台锁定。
- Sandbox 安装固定依赖后关闭网络再构建，且不接收任何生产密钥。
- Preview 只有脚本权限，没有同源、导航、弹窗或下载权限。
- 生成 HTML 必须通过严格 CSP 和远程资源扫描。
- 产品不向用户暴露 Terminal。

## 验证

```bash
pnpm check
```

它会执行 TypeScript、ESLint、Vitest 和生产构建。测试覆盖路径穿越、模板越权、CSP 绕过、远程资源、开放重定向和 Fake 工程源码编译。

## 目录

```text
src/app/                 页面与 Route Handlers
src/app/(app)/           登录后的工作区（共用左侧栏）
src/components/layout/   应用外壳、侧栏与用户卡片
src/components/builder/  Builder、Preview、恢复状态
src/server/llm/          Fake/DeepSeek Provider
src/server/template/     锁定游戏工程模板
src/server/workspace/    文件边界与日志脱敏
src/server/build/        Inline/Sandbox 构建器
supabase/migrations/     Schema、RLS、额度 RPC
docs/                    PRD、实施计划、任务板与演示脚本
```

## 尚需外部控制台完成

- 应用数据库迁移
- 配置 Google OAuth 与 Redirect URL
- 确认公共预算和新用户额度
- 在 Railway 配置环境变量并绑定域名
- 创建 GitHub 远端、推送并部署

这些步骤涉及真实外部项目，仓库不会擅自使用默认额度或自动部署。
