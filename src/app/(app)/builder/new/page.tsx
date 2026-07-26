import { redirect } from "next/navigation";

import { NewProjectForm } from "@/components/builder/new-project-form";
import { createClient } from "@/lib/supabase/server";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string }>;
}) {
  const { prompt } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/builder/new");

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 lg:px-8">
      <h1 className="font-serif text-3xl tracking-tight text-ink">
        你想做点什么？
      </h1>
      <p className="mt-3 max-w-xl leading-7 text-ink-soft">
        一句话就够。描述越具体，第一版越接近你的想法；之后还能继续对话修改。
      </p>

      <div className="mt-9">
        <NewProjectForm initialPrompt={prompt} />

        <dl className="mt-10 grid gap-6 border-t border-line pt-8 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-ink">改坏了也不怕</dt>
            <dd className="mt-1.5 text-sm leading-6 text-ink-soft">
              改砸了不会覆盖上一个能玩的版本，随时可以退回去。
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ink">先玩再改</dt>
            <dd className="mt-1.5 text-sm leading-6 text-ink-soft">
              生成完就能直接上手玩，不满意就接着说，改到顺眼为止。
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
