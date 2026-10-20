# 离线评测（evals）

一句话：**同一批请求，反复跑同一条生成链路，把「成功率」从感觉变成数字。**

改一次提示词、换一个模型、调一个超时，这里给出的是同一组用例上的前后对比，而不是"我试了两个例子感觉好像好了一点"。

```bash
pnpm eval:smoke                       # 零成本，6 个用例，验证链路是否通
pnpm eval                             # 零成本，跑完整数据集
pnpm eval:live                        # 真实调用 DeepSeek，会花钱
pnpm eval -- --mode=live --repeat=3   # 每个用例跑三轮，看稳定性
```

## 它测的是什么

`src/server/generation/run.ts` 是线上路径，它需要 Supabase、额度预占、SSE 和检查点。
评测要量的不是这些，所以 `runner/pipeline.ts` 复刻的是**被测的那一段**，脱开数据库和 HTTP：

```
plan（真实 provider）
  └─ 反问？ → 记为 clarified，不再往下走
  └─ 继续 → write（真实 provider，一次写完全部文件）
              └─ validateAgentFiles（真实白名单）
              └─ createGameWorkspace（真实模板）
              └─ findUnresolvedImports（真实跨文件检查）
              └─ buildWorkspaceLocally（真实 esbuild）
              └─ validateStandaloneHtml（真实 CSP 与远程资源校验）
              └─ 失败一次 → repair 回合（与线上同样只给一次）
```

每一步都调用 `src/` 里的真实模块，评测自己只拥有"顺序"。因此 `run.ts` 的顺序如果变了，
这里要跟着改——否则你量的是一个已经不存在的产品。

## 三类指标

| 指标 | 回答的问题 |
| --- | --- |
| **构建通过率 / 首轮构建通过率** | 一句话进去，出来的工程能不能编译成产物？修复回合救回来了多少？ |
| **澄清判断准确率** | 该问的问了没有，不该问的是不是在瞎问？（两阶段设计的全部价值都在这一行） |
| **工艺分** | 提示词里白纸黑字要求过的规则，模型照做了多少？ |

工艺分只检查 `src/server/llm/prompts.ts` 的 `GAME_CRAFT` **明确要求过**的东西：
用 `requestAnimationFrame` 而不是 `setInterval`、按时间增量推进并钳制、卸载时清理监听、
`preventDefault`、不用 `alert`、有结束态和重开、有 HUD、用相对单位布局、不碰网络与存储。

不检查"好不好玩"。静态检查做不到，硬凑一个数字只会让人信一个假指标。

## 用例集

`datasets/games.v1.jsonl`，一行一个用例，方便逐条 review 和回滚：

```json
{"id":"create-zh-snake","kind":"create","prompt":"做一个贪吃蛇…","expectClarification":false,"tags":["zh","grid","clear"]}
{"id":"ambiguous-zh-bare","kind":"create","prompt":"做个游戏","expectClarification":true,"tags":["zh","ambiguous"]}
{"id":"edit-zh-feature","kind":"edit","seedPrompt":"做一个贪吃蛇…","prompt":"加一个暂停功能…","expectClarification":false,"tags":["zh","edit"]}
```

| 字段 | 说明 |
| --- | --- |
| `expectClarification` | **标注，不是期望值**。true 表示一个正确的 agent 应当停下来问；直接开工算判错。 |
| `seedPrompt` | `edit` 用例先用它跑一次 create，产出的版本才是被编辑的对象。 |
| `tags` | 报告按标签切片，用来定位"中文比英文差"、"puzzle 类比 arcade 类差"这类结论。 |
| `mustMention` | 可选。生成源码中必须出现的字符串。慎用——它很容易把模型钉死在一种实现上。 |

数据集的健康度由 `runner/dataset.test.ts` 守着：重复 id、缺 seed 的 edit 用例、
以及"歧义用例太少导致一个从不反问的模型也能拿满分"，都会让 `pnpm test:run` 变红。

## 输出

每次运行落在 `evals/results/<时间戳>-<provider>/`：

- `report.json` — 机器可读，也是下次 `--baseline` 的输入
- `report.md` — 总览 / 失败归因 / 工艺检查（按通过率升序，排最前的就是最该改提示词的地方）/ 分切片 / 逐用例
- `cases/<id>/attempt-<n>/` — 失败用例的完整工程与 `artifact.html`，直接用浏览器打开就能看

回归对比：

```bash
pnpm eval -- --mode=live --baseline=evals/results/2026-08-30T…-deepseek/report.json
```

报告末尾会列出**回归**（上次对、这次错）和**修复**（上次错、这次对）两张清单。
指标涨了但某个用例回归了，这件事只有逐用例对比才看得见。

## 全部参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--mode` | `fake` | `live` 才会真的调模型 |
| `--dataset` | `evals/datasets/games.v1.jsonl` | 换数据集 |
| `--filter` | 空 | 按 id 片段或 tag 过滤，可重复传，多个条件取交集 |
| `--repeat` | `1` | 每个用例跑几轮；模型是随机的，一轮说明不了稳定性 |
| `--concurrency` | `2` | 并发；live 模式注意对方限流 |
| `--baseline` | 无 | 上一次的 `report.json`，用于回归对比 |
| `--fail-under` | 无 | 构建通过率低于阈值则以非零码退出，CI 用 |
| `--keep-artifacts` | 关 | 默认只保留失败用例和每个用例的第一轮产物 |
| `--price-in` / `--price-out` | `0.28` / `0.42` | 每百万 token 单价，用于折算成本 |
| `--limit` | 无 | 只跑前 N 个用例 |

## 关于 fake 模式

`fake` provider 返回固定工程，**从不反问**。所以 fake 模式下 ambiguous 切片必然全红，
澄清准确率也没有意义——它验证的是"链路通不通"，不是"模型好不好"。报告顶部会标出这一点。

有意思的是它并非全绿：固定工程本身就漏掉了 `delta-time`、`delta-clamp` 和 `preventDefault`
三项，工艺分停在 ~82%。判分器在自己的 fixture 上都不放水，这正是它可信的前提。

## 为什么是 `node evals/run.mjs` 而不是 `tsx`

仓库里没有 TS 运行器，但有 esbuild——产品本来就用它构建生成的游戏。
`run.mjs` 先加载 `.env.local`，再用 esbuild 把 `runner/main.ts` 打成一个临时 ESM 模块并导入。
不引入新依赖，运行的代码同时被 `pnpm typecheck` 和 `pnpm lint` 覆盖。

（`server-only` 只在 Next.js 打包器里存在，所以打包时被指向 `runner/stubs/server-only.js` 这个空模块。）

## 下一步

1. 把用例从 30 条扩到 100 条以上，尤其补 edit 与多轮对话。
2. 在 CI 上按 PR 跑 `--mode=fake --fail-under=1`，每周手动跑一次 live 并留档 baseline。
3. 工艺分只能覆盖"提示词说过的规则"。要判断"好不好玩"，需要引入人工标注或模型评审，
   在有一批人工标注之前，不要给这类分数任何权重。
