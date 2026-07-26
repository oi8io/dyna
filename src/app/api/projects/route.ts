import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getGameGenerationProvider } from "@/server/llm";
import { normalizeTitle } from "@/server/llm/title";

const createProjectSchema = z.object({
  prompt: z.string().trim().min(8).max(4000),
});

/**
 * Names the project once, at creation.
 *
 * The name belongs to the project, not to a version: it is what appears in the
 * sidebar and on every published card, and it must not drift because someone
 * asked for a faster ball. Extraction is a comprehension task, so it goes to
 * the model rather than to string surgery — a rule-based version only handles
 * the openers it was taught, and "我想玩那种在末日废土上开车撞僵尸的游戏"
 * has none of them.
 *
 * The heuristic remains as a fallback, so a naming outage costs a good name
 * rather than the ability to create a project.
 */
async function nameProject(prompt: string) {
  try {
    const name = await getGameGenerationProvider().nameProject(prompt);
    return normalizeTitle(name, "新作品");
  } catch (error) {
    console.error("[project_naming_failed]", error);
    return normalizeTitle(prompt, "新作品");
  }
}

export async function POST(request: Request) {
  const parsed = createProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "请用至少 8 个字描述你想做的游戏。" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      title: await nameProject(parsed.data.prompt),
      original_prompt: parsed.data.prompt,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !project) {
    return NextResponse.json(
      {
        error:
          "项目创建失败。请确认 Supabase 迁移已执行，并检查服务配置。",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ projectId: project.id }, { status: 201 });
}
