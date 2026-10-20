import { describe, expect, it } from "vitest";

import { PROBE_IDS, checkMustMention, craftScore, scoreCraft } from "./scorers";

/**
 * The scorer is the thing every eval number rests on, so it gets tested like
 * production code. A probe that silently always passes would make a regression
 * look like an improvement, which is worse than having no eval at all.
 */

const GOOD_CODE = `
import { useEffect, useRef } from "react";

export function useGameLoop(step: (deltaMs: number) => void) {
  const frame = useRef(0);
  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(100, now - last);
      last = now;
      step(delta);
      frame.current = requestAnimationFrame(tick);
    };
    const onKey = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    frame.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("keydown", onKey);
    };
  }, [step]);
}

export const HUD_LABELS = { score: "分数", lives: "生命" };
export const HINT = "方向键移动，空格开球";
export const GAME_OVER = "游戏结束";
export const RESTART = "再来一局";
`;

const GOOD_CSS = `
.stage { width: min(94vw, 820px); height: 70vh; }
.hud { font-size: clamp(12px, 2vw, 18px); }
`;

const goodFiles = [
  { path: "src/game/loop.ts", content: GOOD_CODE },
  { path: "src/styles.css", content: GOOD_CSS },
];

function idsFailing(files: Array<{ path: string; content: string }>) {
  return scoreCraft({ agentFiles: files, artifactHtml: "<!doctype html>" })
    .filter((probe) => !probe.passed)
    .map((probe) => probe.id);
}

describe("craft probes", () => {
  it("passes a file that follows every rule the prompt states", () => {
    expect(idsFailing(goodFiles)).toEqual([]);
    expect(craftScore(scoreCraft({ agentFiles: goodFiles, artifactHtml: "" }))).toBe(1);
  });

  it("catches a loop driven by setInterval with no animation frame", () => {
    const files = [
      { path: "src/game/loop.ts", content: "setInterval(() => tick(), 16);" },
      { path: "src/styles.css", content: GOOD_CSS },
    ];
    expect(idsFailing(files)).toContain("no-interval-gameplay");
    expect(idsFailing(files)).toContain("raf-loop");
  });

  it("catches a frame-counted loop with no time delta", () => {
    const files = [
      {
        path: "src/game/loop.ts",
        content: GOOD_CODE.replace(/delta|performance\.now\(\)|Math\.min\(100, now - last\)/g, "frames"),
      },
      { path: "src/styles.css", content: GOOD_CSS },
    ];
    expect(idsFailing(files)).toContain("delta-time");
  });

  it("catches a listener that is never removed", () => {
    const files = [
      {
        path: "src/game/loop.ts",
        content: GOOD_CODE.replace("window.removeEventListener(\"keydown\", onKey);", ""),
      },
      { path: "src/styles.css", content: GOOD_CSS },
    ];
    expect(idsFailing(files)).toContain("cleanup");
  });

  it("catches the blocking dialogs the prompt forbids", () => {
    const files = [
      { path: "src/game/loop.ts", content: `${GOOD_CODE}\nalert("you lost");` },
      { path: "src/styles.css", content: GOOD_CSS },
    ];
    expect(idsFailing(files)).toContain("no-modal-dialogs");
  });

  it("does not mistake the modulo operator for a responsive unit", () => {
    const files = [
      { path: "src/game/loop.ts", content: `${GOOD_CODE}\nconst wrapped = index % 20;` },
      { path: "src/styles.css", content: ".stage { width: 820px; height: 500px; }" },
    ];
    const failing = idsFailing(files);
    expect(failing).toContain("responsive-layout");
    expect(failing).toContain("no-fixed-playfield");
  });

  it("catches the sandbox escapes: network, storage and remote assets", () => {
    const files = [
      {
        path: "src/game/loop.ts",
        content: `${GOOD_CODE}\nfetch("https://cdn.example.com/sprite.png");\nlocalStorage.setItem("best", "1");`,
      },
      { path: "src/styles.css", content: GOOD_CSS },
    ];
    const failing = idsFailing(files);
    expect(failing).toContain("no-network");
    expect(failing).toContain("no-storage");
    expect(failing).toContain("no-remote-assets");
  });

  it("allows the SVG namespace, which is a URL but not a remote asset", () => {
    const files = [
      {
        path: "src/game/loop.ts",
        content: `${GOOD_CODE}\nconst NS = "http://www.w3.org/2000/svg";`,
      },
      { path: "src/styles.css", content: GOOD_CSS },
    ];
    expect(idsFailing(files)).not.toContain("no-remote-assets");
  });

  it("weights the score rather than counting probes equally", () => {
    const results = scoreCraft({ agentFiles: goodFiles, artifactHtml: "" });
    expect(results).toHaveLength(PROBE_IDS.length);
    expect(results.some((probe) => probe.weight > 1)).toBe(true);
  });
});

describe("must-mention", () => {
  it("passes when the case asked for nothing in particular", () => {
    expect(checkMustMention({ agentFiles: goodFiles, artifactHtml: "" }, undefined).passed).toBe(
      true,
    );
  });

  it("reports every missing requirement, case-insensitively", () => {
    const result = checkMustMention(
      { agentFiles: goodFiles, artifactHtml: "" },
      ["ArrowLeft", "gamepad"],
    );
    expect(result.passed).toBe(false);
    expect(result.missing).toEqual(["gamepad"]);
  });
});
