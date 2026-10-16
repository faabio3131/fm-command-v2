import type { Metadata } from "next";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { I18nProvider } from "@/i18n/react/i18n-provider";
import { CATALOGS, createTranslator } from "@/i18n/translate";
import "./globals.css";
import "./command-auth-premium.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = createTranslator(await getRequestLocale());
  return { title: "FM Command | FM Tecnologia", description: t("meta.description") };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale} messages={CATALOGS[locale]}>{children}</I18nProvider>
      </body>
    </html>
  );
}
