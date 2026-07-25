import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";
import { isLiveGenerationReady } from "@/server/env";
import type { Profile, Project } from "@/types/database";

/**
 * Chrome for the signed-in area.
 *
 * It does not redirect anonymous visitors: each page redirects with its own
 * `next` parameter, and a redirect here would fire first and throw that away.
 * A visitor without a session simply gets no sidebar on the way past.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <>{children}</>;

  const [{ data: profileData }, { data: recentData }] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("projects")
      .select("id, title")
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(8),
  ]);
  const profile = profileData as Profile | null;
  const recent = (recentData ?? []) as Pick<Project, "id" | "title">[];

  return (
    <AppShell
      email={user.email ?? "未知账户"}
      displayName={profile?.display_name ?? null}
      createCredits={profile?.create_credits ?? 0}
      editCredits={profile?.edit_credits ?? 0}
      mode={isLiveGenerationReady() ? "Live" : "Safe demo"}
      recent={recent}
    >
      {children}
    </AppShell>
  );
}
