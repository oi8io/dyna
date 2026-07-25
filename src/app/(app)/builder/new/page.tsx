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
            <dt className="text-sm font-medium text-ink">安全隔离</dt>
            <dd className="mt-1.5 text-sm leading-6 text-ink-soft">
              生成的代码读不到你的环境变量、其他项目文件或主站身份。
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-ink">版本可追溯</dt>
            <dd className="mt-1.5 text-sm leading-6 text-ink-soft">
              每次修改都会生成新快照，失败不会覆盖上一个能跑的版本。
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
