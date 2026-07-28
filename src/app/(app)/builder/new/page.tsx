import { redirect } from "next/navigation";

import { NewProjectForm } from "@/components/builder/new-project-form";
import { getDictionary } from "@/lib/i18n/server";
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
  const t = await getDictionary();

  return (
    <div className="mx-auto max-w-3xl px-5 py-16 lg:px-8">
      <h1 className="font-serif text-3xl tracking-tight text-ink">
        {t.newProject.title}
      </h1>
      <p className="mt-3 max-w-xl leading-7 text-ink-soft">
        {t.newProject.subtitle}
      </p>

      <div className="mt-9">
        <NewProjectForm initialPrompt={prompt} />

        <dl className="mt-10 grid gap-6 border-t border-line pt-8 sm:grid-cols-2">
          {t.newProject.reassurance.map((item) => (
            <div key={item.title}>
              <dt className="text-sm font-medium text-ink">{item.title}</dt>
              <dd className="mt-1.5 text-sm leading-6 text-ink-soft">
                {item.text}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
