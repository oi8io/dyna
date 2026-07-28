import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api-error";
import { createClient } from "@/lib/supabase/server";
import { remixErrorResponse } from "@/server/remix/errors";

const paramsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{5,47}$/),
});

/**
 * Remix clones a published snapshot into a new project owned by the caller.
 * It performs no model call, so it costs no credits; the database function
 * carries its own rate guard.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return apiError("invalid_slug", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return apiError("not_authenticated", 401);
  }

  const { data: projectId, error } = await supabase.rpc("remix_publication", {
    p_slug: params.data.slug,
  });

  if (error || typeof projectId !== "string") {
    const mapped = remixErrorResponse(error?.message ?? "");
    return apiError(mapped.code, mapped.status);
  }

  return NextResponse.json({ projectId }, { status: 201 });
}
