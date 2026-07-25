import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  // Empty clears the nickname and falls back to the anonymous label in public
  // listings, so it is allowed.
  displayName: z.string().trim().max(40),
});

export async function PATCH(request: Request) {
  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: "昵称最多 40 个字符。" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  // `profiles_update_own` restricts this to the caller's own row; the explicit
  // filter is a second guard rather than the only one.
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: body.data.displayName || null })
    .eq("user_id", user.id)
    .select("display_name")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "保存失败，请重试。" }, { status: 500 });
  }

  return NextResponse.json({ displayName: data.display_name });
}
