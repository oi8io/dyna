import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const createProjectSchema = z.object({
  prompt: z.string().trim().min(8).max(4000),
});

function titleFromPrompt(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 60);
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
      title: titleFromPrompt(parsed.data.prompt),
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
