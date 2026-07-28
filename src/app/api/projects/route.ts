import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-error";
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
    return normalizeTitle(name);
  } catch (error) {
    console.error("[project_naming_failed]", error);
    return normalizeTitle(prompt);
  }
}

export async function POST(request: Request) {
  const parsed = createProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return apiError("prompt_too_short", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("not_authenticated", 401);
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
    return apiError("project_create_failed", 500);
  }

  return NextResponse.json({ projectId: project.id }, { status: 201 });
}
