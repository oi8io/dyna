import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-error";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  visibility: z.enum(["public", "private"]),
});

/**
 * Flips source visibility for every publication of a project.
 *
 * It applies to all snapshots rather than just the newest one so that revoking
 * remix rights actually revokes them — an older public snapshot would otherwise
 * remain forkable. Play links are untouched: `is_active` never changes here.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json());
  if (!params.success || !body.success) {
    return apiError("invalid_request", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("not_authenticated", 401);
  }

  // RLS (`published_owner_update`) restricts this to rows the caller owns; the
  // owner_id filter is a second, explicit guard.
  const { data, error } = await supabase
    .from("published_games")
    .update({ visibility: body.data.visibility })
    .eq("project_id", params.data.id)
    .eq("owner_id", user.id)
    .select("slug");

  if (error) {
    return apiError("visibility_update_failed", 500);
  }
  if (!data?.length) {
    return apiError("not_published", 409);
  }

  return NextResponse.json({
    visibility: body.data.visibility,
    updated: data.length,
  });
}
