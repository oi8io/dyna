import type { Metadata } from "next";

import "@/app/globals.css";
import { I18nProvider } from "@/lib/i18n/client";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: { default: t.metadata.title, template: "%s · Dyna Studio" },
    description: t.metadata.description,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { locale } = await getI18n();

  return (
    <html lang={locale}>
      <body>
        {/* Only the locale crosses the boundary; each client component looks
            its own copy up from the bundle. */}
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
