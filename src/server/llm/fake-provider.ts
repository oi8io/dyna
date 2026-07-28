import type { StreamDelta } from "@/lib/generation-events";
import type {
  GameGenerationProvider,
  PlanInput,
  PlanResult,
  WriteInput,
  WriteResult,
} from "@/server/llm/types";
import type { AgentFile } from "@/server/workspace/schema";
import { validateAgentFiles } from "@/server/workspace/schema";

/** Roughly a fast model's output rate, so demo mode feels like the real thing. */
const REPLAY_CHARS_PER_TICK = 220;
const REPLAY_TICK_MS = 22;

/**
 * The fake provider has nothing to stream — the workspace exists the instant it
 * is asked for. It replays the finished files so demo mode exercises the same
 * UI path as live mode. This is a simulation, not real progress; the builder
 * labels the run as `Fake demo` so nobody mistakes it for a model call.
 */
async function replayFile(
  file: { path: string; content: string },
  onProgress: (delta: StreamDelta) => void,
) {
  onProgress({ type: "file-open", path: file.path });
  for (let at = 0; at < file.content.length; at += REPLAY_CHARS_PER_TICK) {
    onProgress({
      type: "file-delta",
      path: file.path,
      text: file.content.slice(at, at + REPLAY_CHARS_PER_TICK),
    });
    await new Promise((resolve) => setTimeout(resolve, REPLAY_TICK_MS));
  }
  onProgress({ type: "file-close", path: file.path });
}

function safeJson(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function titleFromPrompt(prompt: string) {
  const concise = prompt.replace(/\s+/g, " ").trim().slice(0, 34);
  return concise || "Neon Breaker";
}

function createArtifact(input: Pick<PlanInput, "kind" | "prompt">) {
  const title = titleFromPrompt(input.prompt);
  const prompt = safeJson(input.prompt);
  const editNote =
    input.kind === "edit"
      ? "这是根据你的新要求更新后的版本。"
      : "方向键或 A/D 移动挡板，清空所有砖块。";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${title.replace(/[<&]/g, "")}</title>
  <style>
    *{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}body{display:grid;place-items:center;background:radial-gradient(circle at 50% 0,#172554,#030712 58%);color:#e0f2fe;font:14px ui-sans-serif,system-ui}
    .shell{width:min(94vw,820px)}header{display:flex;justify-content:space-between;align-items:end;margin-bottom:12px}.eyebrow{color:#67e8f9;font-size:11px;letter-spacing:.18em;text-transform:uppercase}h1{font-size:clamp(20px,4vw,32px);margin:4px 0 0}.stats{display:flex;gap:10px}.pill{padding:7px 11px;border:1px solid #ffffff22;border-radius:999px;background:#ffffff0b}
    .stage{position:relative;overflow:hidden;border:1px solid #67e8f944;border-radius:22px;background:#020617;box-shadow:0 28px 80px #0009,0 0 50px #22d3ee12}canvas{display:block;width:100%;aspect-ratio:16/10}
    .overlay{position:absolute;inset:0;display:grid;place-items:center;background:#020617c9;backdrop-filter:blur(7px)}.overlay[hidden]{display:none}.panel{max-width:420px;padding:28px;text-align:center}.panel p{color:#a5b4fc;line-height:1.6}.panel button{border:0;border-radius:12px;padding:11px 18px;background:#67e8f9;color:#042f2e;font-weight:800;cursor:pointer}
    footer{display:flex;justify-content:space-between;margin-top:10px;color:#64748b;font-size:12px}kbd{border:1px solid #ffffff22;border-bottom-width:2px;border-radius:5px;padding:2px 6px;color:#cbd5e1}
  </style>
</head>
<body>
  <main class="shell">
    <header><div><div class="eyebrow">Dyna generated game</div><h1>${title.replace(/[<&]/g, "")}</h1></div><div class="stats"><span class="pill">分数 <b id="score">0</b></span><span class="pill">生命 <b id="lives">3</b></span></div></header>
    <section class="stage"><canvas id="game" width="800" height="500"></canvas><div class="overlay" id="overlay"><div class="panel"><div class="eyebrow">Ready Player One</div><h2>击碎霓虹防线</h2><p>${editNote}</p><button id="start">开始游戏</button></div></div></section>
    <footer><span><kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd></span><span>创意来源：<span id="idea"></span></span></footer>
  </main>
<script>
const idea=${prompt};document.querySelector('#idea').textContent=idea.slice(0,38);
const canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'),overlay=document.querySelector('#overlay');
let paddle={x:340,y:458,w:120,h:12},ball,bricks,score=0,lives=3,running=false,keys={};
function resetBall(){ball={x:400,y:390,r:7,dx:(Math.random()>.5?1:-1)*4.2,dy:-4.2}}
function resetBricks(){bricks=[];for(let r=0;r<5;r++)for(let c=0;c<10;c++)bricks.push({x:35+c*74,y:48+r*34,w:62,h:18,on:true,hue:185+r*24})}
function newGame(){score=0;lives=3;paddle.x=340;resetBall();resetBricks();running=true;overlay.hidden=true;sync();requestAnimationFrame(loop)}
function sync(){document.querySelector('#score').textContent=score;document.querySelector('#lives').textContent=lives}
function end(title,text){running=false;overlay.hidden=false;overlay.querySelector('h2').textContent=title;overlay.querySelector('p').textContent=text;document.querySelector('#start').textContent='再来一局'}
function draw(){ctx.clearRect(0,0,800,500);ctx.fillStyle='#020617';ctx.fillRect(0,0,800,500);for(let x=0;x<800;x+=40){ctx.strokeStyle='#ffffff08';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,500);ctx.stroke()}bricks.forEach(b=>{if(!b.on)return;ctx.shadowBlur=14;ctx.shadowColor='hsl('+b.hue+' 90% 60%)';ctx.fillStyle='hsl('+b.hue+' 75% 55%)';ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,6);ctx.fill()});ctx.shadowBlur=18;ctx.shadowColor='#67e8f9';ctx.fillStyle='#a5f3fc';ctx.beginPath();ctx.roundRect(paddle.x,paddle.y,paddle.w,paddle.h,8);ctx.fill();ctx.shadowColor='#c4b5fd';ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}
function update(){if(keys.ArrowLeft||keys.a)paddle.x-=7;if(keys.ArrowRight||keys.d)paddle.x+=7;paddle.x=Math.max(0,Math.min(800-paddle.w,paddle.x));ball.x+=ball.dx;ball.y+=ball.dy;if(ball.x<ball.r||ball.x>800-ball.r)ball.dx*=-1;if(ball.y<ball.r)ball.dy=Math.abs(ball.dy);if(ball.y+ball.r>=paddle.y&&ball.y<paddle.y+16&&ball.x>=paddle.x&&ball.x<=paddle.x+paddle.w){ball.dy=-Math.abs(ball.dy);ball.dx+=(ball.x-(paddle.x+paddle.w/2))*.035}for(const b of bricks){if(b.on&&ball.x>b.x&&ball.x<b.x+b.w&&ball.y+ball.r>b.y&&ball.y-ball.r<b.y+b.h){b.on=false;ball.dy*=-1;score+=100;sync();break}}if(bricks.every(b=>!b.on)){end('你赢了！','霓虹防线已清空，最终得分 '+score);return}if(ball.y>510){lives--;sync();if(lives<=0){end('游戏结束','再试一次，这次瞄准砖块的边缘。');return}resetBall()}}
function loop(){if(!running)return;update();draw();requestAnimationFrame(loop)}
addEventListener('keydown',e=>{keys[e.key]=true;if(['ArrowLeft','ArrowRight',' '].includes(e.key))e.preventDefault()});addEventListener('keyup',e=>keys[e.key]=false);document.querySelector('#start').onclick=newGame;resetBall();resetBricks();draw();
<\/script>
</body></html>`;
}

export class FakeGameProvider implements GameGenerationProvider {
  /**
   * Demo mode always has a plan and never has a question: the fixture is fully
   * determined, so inventing ambiguity would be theatre. The clarification path
   * is exercised in live mode only.
   */
  async plan(input: PlanInput): Promise<PlanResult> {
    return {
      plan: {
        understanding:
          input.kind === "edit"
            ? `在现有作品上应用：${input.prompt}`
            : `新建一个作品：${input.prompt}`,
        // Ordered so later files can rely on earlier ones, matching what the
        // real planner is asked to produce.
        changes: [
          { path: "src/game/engine.ts", intent: "实现核心玩法循环" },
          { path: "src/App.tsx", intent: "渲染游戏外壳与状态显示" },
          { path: "src/styles.css", intent: "布局与视觉样式" },
          { path: "README.md", intent: "说明玩法与操作" },
        ],
        assumptions: ["Fake 模式返回固定示例工程，不反映真实需求理解。"],
        questions: [],
        spec: {
          goal: "一个可以直接上手、几秒内理解规则的轻量网页小游戏。",
          coreLoop:
            "每 1-2 秒球往返一次，玩家移动挡板接住它，逐块清空砖墙。",
          controls: [
            "← / → 或 A / D：左右移动挡板",
            "空格：开球，以及游戏结束后重开一局",
          ],
          genreConventions: [
            "挡板的接触点决定反弹角度，边缘出球角度更斜",
            "球速随进度上升，但不会突然跳变",
            "剩余最后几块砖时不应出现无法命中的死角",
          ],
          difficulty: [
            "初始球速 4，每清除 10 块提速 8%，上限 12",
            "初始 3 条命，清空整墙进入下一关且不重置分数",
          ],
          feedback: [
            "球撞挡板时挡板闪白 80ms",
            "砖块破碎时溅出 6 个粒子并加分跳数",
            "失去一条命时画面轻微震动 200ms",
          ],
          winLose: [
            "胜：清空全部砖块",
            "负：三条命耗尽，显示最终分数与重开提示",
          ],
          constraints: ["不使用远程素材", "单人、键盘操作"],
          decisions: [
            {
              decision: "初始生命值设为 3",
              why: "留出试错空间，避免第一次上手就结束。",
            },
          ],
          openQuestions: [],
        },
        changeSummary:
          input.kind === "edit" ? "应用了一次示例修改。" : "生成了示例工程。",
      },
      provider: "fake" as const,
      model: "deterministic-plan-fixture-v1",
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
  }

  async nameProject(prompt: string): Promise<string> {
    return titleFromPrompt(prompt);
  }

  prebuiltArtifactHtml(input: PlanInput) {
    return createArtifact(input);
  }

  async write(input: WriteInput): Promise<WriteResult> {
    const title = titleFromPrompt(input.prompt);
    const fixture = fakeAgentFiles(title, input.prompt);

    const candidates = input.plan.changes.map(
      (change) =>
        fixture.find((entry) => entry.path === change.path) ?? {
          path: change.path,
          content: `// ${change.path}\n// ${change.intent}\n`,
        },
    );

    // The same boundary the live provider enforces. Demo mode must not be able
    // to produce a workspace that live mode would reject.
    const files = validateAgentFiles(candidates) as AgentFile[];

    if (input.onProgress) {
      for (const file of files) await replayFile(file, input.onProgress);
    }

    return {
      files,
      provider: "fake" as const,
      model: "deterministic-game-fixture-v1",
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
  }
}

function fakeAgentFiles(title: string, prompt: string) {
  return [
    {
          path: "src/App.tsx",
          content: `import { useEffect, useRef, useState } from "react";
import { BreakoutEngine } from "./game/engine";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BreakoutEngine | null>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new BreakoutEngine(canvasRef.current, ({ score, lives }) => {
      setScore(score);
      setLives(lives);
    });
    engine.start();
    engineRef.current = engine;
    return () => engine.destroy();
  }, []);

  return <main className="game-shell">
    <header><div><span>Dyna generated game</span><h1>${title.replaceAll("`", "")}</h1></div><div className="stats"><b>分数 {score}</b><b>生命 {lives}</b></div></header>
    <canvas ref={canvasRef} width={800} height={500} aria-label="打砖块游戏区域" />
    <footer><span>← → / A D 移动</span><button onClick={() => engineRef.current?.reset()}>重新开始</button></footer>
  </main>;
}`,
        },
        {
          path: "src/game/engine.ts",
          content: `export interface GameState { score: number; lives: number }
export class BreakoutEngine {
  private context: CanvasRenderingContext2D;
  private frame = 0;
  private state: GameState = { score: 0, lives: 3 };
  private paddle = { x: 340, y: 458, width: 120 };
  private ball = { x: 400, y: 390, dx: 4, dy: -4, radius: 7 };
  private keys = new Set<string>();
  private bricks = Array.from({ length: 50 }, (_, index) => ({
    x: 35 + (index % 10) * 74, y: 48 + Math.floor(index / 10) * 34, active: true,
  }));
  constructor(private canvas: HTMLCanvasElement, private onState: (state: GameState) => void) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    this.context = context;
    addEventListener("keydown", this.keyDown);
    addEventListener("keyup", this.keyUp);
  }
  start() { this.frame = requestAnimationFrame(this.loop); }
  destroy() { cancelAnimationFrame(this.frame); removeEventListener("keydown", this.keyDown); removeEventListener("keyup", this.keyUp); }
  reset() { this.state = { score: 0, lives: 3 }; this.ball = { x: 400, y: 390, dx: 4, dy: -4, radius: 7 }; this.bricks.forEach(b => b.active = true); this.onState(this.state); }
  private keyDown = (event: KeyboardEvent) => this.keys.add(event.key);
  private keyUp = (event: KeyboardEvent) => this.keys.delete(event.key);
  private loop = () => { this.update(); this.draw(); this.frame = requestAnimationFrame(this.loop); };
  private update() {
    if (this.keys.has("ArrowLeft") || this.keys.has("a")) this.paddle.x -= 7;
    if (this.keys.has("ArrowRight") || this.keys.has("d")) this.paddle.x += 7;
    this.paddle.x = Math.max(0, Math.min(680, this.paddle.x));
    const ball = this.ball; ball.x += ball.dx; ball.y += ball.dy;
    if (ball.x < 7 || ball.x > 793) ball.dx *= -1;
    if (ball.y < 7) ball.dy = Math.abs(ball.dy);
    if (ball.y > 450 && ball.y < 475 && ball.x > this.paddle.x && ball.x < this.paddle.x + 120) ball.dy = -Math.abs(ball.dy);
    for (const brick of this.bricks) if (brick.active && ball.x > brick.x && ball.x < brick.x + 62 && ball.y > brick.y && ball.y < brick.y + 18) { brick.active = false; ball.dy *= -1; this.state.score += 100; this.onState({ ...this.state }); break; }
    if (ball.y > 510) { this.state.lives -= 1; this.onState({ ...this.state }); this.ball = { x: 400, y: 390, dx: 4, dy: -4, radius: 7 }; }
  }
  private draw() {
    const c = this.context; c.fillStyle = "#020617"; c.fillRect(0, 0, 800, 500);
    this.bricks.forEach((b, i) => { if (!b.active) return; c.fillStyle = "hsl(" + (185 + Math.floor(i / 10) * 24) + " 75% 55%)"; c.roundRect(b.x, b.y, 62, 18, 6); c.fill(); });
    c.fillStyle = "#a5f3fc"; c.roundRect(this.paddle.x, this.paddle.y, 120, 12, 8); c.fill();
    c.fillStyle = "#fff"; c.beginPath(); c.arc(this.ball.x, this.ball.y, 7, 0, Math.PI * 2); c.fill();
  }
}`,
        },
        {
          path: "src/styles.css",
          content: `*{box-sizing:border-box}html,body,#root{height:100%;margin:0}body{display:grid;place-items:center;background:radial-gradient(circle at 50% 0,#172554,#030712 58%);color:#e0f2fe;font:14px system-ui}.game-shell{width:min(94vw,820px)}header,footer{display:flex;align-items:center;justify-content:space-between;gap:16px}header span{color:#67e8f9;font-size:11px;letter-spacing:.18em;text-transform:uppercase}h1{margin:5px 0 12px}.stats{display:flex;gap:10px}.stats b,button{border:1px solid #ffffff22;border-radius:999px;padding:8px 12px;background:#ffffff0b;color:inherit}canvas{display:block;width:100%;border:1px solid #67e8f944;border-radius:22px;background:#020617;box-shadow:0 28px 80px #0009}footer{margin-top:10px;color:#64748b}button{cursor:pointer}`,
        },
    {
      path: "README.md",
      content: `# ${title}\n\nPrompt: ${prompt}\n\nReact + TypeScript 多文件游戏工程。`,
    },
  ];
}
