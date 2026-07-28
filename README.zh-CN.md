# Dyna Studio

[English](README.md) · **简体中文**

**线上地址：<https://dyna.oio.sale>**

Dyna Studio 是一个 Web 作品生成器：用户登录后，用一句话生成真实的 React/TypeScript 工程，立即试玩、继续对话修改，并发布公开链接。首个品类是网页小游戏，后续扩展到动画、短剧、设计和网页。

默认使用零成本 `fake` 模式。它仍会创建项目、保存多文件源码、生成版本、运行安全校验、展示可玩产物并发布快照。切换到 `live` 后，同一链路会调用 DeepSeek 并真实构建源码。


## 已实现

**生成链路**

- 一句话创建、自然语言修改和失败恢复
- 创建时用 flash 模型提炼作品名称；名称与版本需求解耦，此后任何版本都不会改名
- 两阶段生成：先出计划，需求含糊时停下来问（不消耗额度），确认后才写代码
- 一次调用写完全部文件，避免逐文件写入导致的跨文件不一致
- `SPEC.md` 记录作品意图与已做决定，随版本、发布和 Remix 传递
- 编辑只重写改动的文件，构建失败自动带着编译错误重试一次

**可靠性**

- 生成任务脱离 HTTP 连接，浏览器关闭不会杀死任务
- SSE 断线自动重连，凭 `Last-Event-ID` 重放错过的事件，而不是重新生成
- 按阶段落检查点（计划 / 草稿 / 构建 / 发布），失败后可从最近的检查点续跑
- 上下文预算与压缩截断，长对话不会撑爆窗口
- 泄漏的额度预占由 `reap_stale_generations` 回收

**账号与数据**

- Google OAuth（遵循官方品牌规范）与邮箱 Magic Link 登录
- Supabase 项目、消息、源码、版本、用量和发布快照模型
- RLS 所有权隔离

**构建与安全**

- 进程内 esbuild 构建器（Vercel 上可选 Sandbox microVM）
- 文件白名单、路径穿越防护、体积和远程资源限制
- 原子额度预占、幂等、全局预算、并发和速率限制
- `iframe sandbox="allow-scripts"` 隔离预览
- CSP、日志脱敏和开放重定向防护

**发布与传播**

- 不可变公开试玩链接（发布后永久有效）
- 首页画廊只展示已发布作品；未发布的项目完全私有
- 一键 Remix，复制的是发布时的快照而非作者的当前版本
- 发布时可选择是否允许别人 Remix，事后可随时收回

## 技术栈

Next.js 16、React 19、TypeScript、Tailwind CSS 4、shadcn 风格组件、shiki、Supabase、DeepSeek、Vitest 和 esbuild，部署在 Railway 的常驻 Node 进程上。

生成过程通过 SSE 实时推送：模型每写出一段代码，Builder 的只读编辑器就同步显示，并自动切到正在写的文件。

## 路线图

四件事，是一条因果链而不是四个并列功能：

```
多品类          动画 / 短剧 / 设计 / 网页，引入分类
   ↓            品类变多，算力需求上升
Worker 队列      生成改为排队执行，而不是来一个跑一个
   ↓            有排队，“免排队” 才是可交付的东西
Pro / Plus 套餐  付费用户优先调度
   ↓            套餐之外的弹性需求
积分与充值       按 token 实际消耗结算
```

**队列不是性能优化，是商业模式的前提。**

**多品类。** 生成引擎从一开始就没有假设产物是游戏——检查点状态机、SSE 重连、上下文压缩、构建、额度、CSP 隔离、发布与 Remix 全部与品类无关。与游戏耦合的只有四处：工程骨架、可写路径白名单、提示词里的领域词、产物自检探针。因此扩展方式是**加配方，不是加分支**：每个品类是一份 `Recipe`，声明自己的模板、白名单、领域提示词片段和成功判据，引擎零改动。品类由创建时那次 flash 调用顺带判断（与提炼名称同一次请求），用户可覆盖，且与名称一样在创建时确定、不随版本变化。

**Worker 队列。** 现在生成任务直接开跑，并发不受控。计划用 Postgres 的 `FOR UPDATE SKIP LOCKED` 做队列而非引入 Redis——检查点和额度预占已经都在同一个数据库里，外部队列会分裂出第二个真相来源。配套租约机制让崩溃的 worker 释放任务，接手方从检查点续跑而非重头开始。

**套餐与积分。** 优先级即套餐，并加 aging 防止免费用户饥饿——付费买到的是更短的等待，不是无限期插队。积分从「次数」演进为「按 token 实际消耗结算」，而 `generation_jobs` 上已有 `input_tokens` / `output_tokens` / `reserved_usd` / `final_usd`，要改的是计价单位而非计费架构。

已知难点：非游戏品类的成功判据更弱——海报「构图难看」、动画「节奏不对」都能通过构建检查。在这个问题解决之前，新品类不会标为已支持。


## 本地启动

要求 Node.js 22+ 和 pnpm 9+。

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开 `http://localhost:3000`。所有变量记录在 `.env.example`；真实密钥只放 `.env.local` 或部署平台的服务端环境变量。

## Supabase 初始化

Schema 位于 `supabase/migrations/`，需按顺序全部应用：

| 迁移 | 作用 |
| --- | --- |
| `202607240001_initial_schema` | 基础模型、RLS、额度 RPC |
| `202607250001_visibility_and_remix` | 可见性、画廊与 Remix |
| `202607250002_remix_carries_spec` | Remix 继承发布快照中的作品意图 |
| `202607250003_reap_stale_generations` | 回收僵死任务泄漏的额度预占 |
| `202607250004_split_generation_steps` | 计划与草稿分别落库 |
| `202607250005_resumable_generations` | 生成变成可续跑的检查点状态机 |

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
src/server/llm/          Fake/DeepSeek Provider 与提示词
src/server/generation/   检查点状态机、run registry、SSE 事件流
src/server/template/     锁定游戏工程模板
src/server/workspace/    文件边界与日志脱敏
src/server/build/        Inline/Sandbox 构建器
supabase/migrations/     Schema、RLS、额度 RPC
```

## 自行部署所需的外部配置

代码本身开箱可跑（`fake` 模式无需任何密钥）。要跑起 `live` 模式，需要在各自的控制台完成：

- 应用 `supabase/migrations/` 下的全部迁移
- 在 Supabase Auth 配置 Google OAuth Client 与 Redirect URL
- 在 SQL Editor 设置公共预算和新用户额度
- 在托管平台配置环境变量并绑定域名

仓库不会擅自使用默认额度或自动部署——预算和密钥属于真实外部项目，必须由部署者显式确认。

## 许可证

Dyna Studio 采用 **GNU Affero General Public License v3.0** 授权 —— 见 [`LICENSE`](LICENSE)。

简单说：随便用、随便 fork、随便部署，也可以在它之上卖服务。但如果你把改过的版本作为网络服务对外提供，AGPL 第 13 条要求你必须向该服务的使用者提供你这份修改的完整对应源码。抹掉品牌、闭源上线是不允许的。

如果你希望在不承担 AGPL 源码开放义务的前提下使用这份代码，可以购买单独的**商业授权**。联系 <hxangel@gmail.com>。

对本项目的贡献需接受[贡献者许可协议](CLA.md)，这是双重授权得以成立的前提。
