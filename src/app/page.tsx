import Link from "next/link";
import { getRequestLocale } from "@/application/i18n/request-locale";
import { createTranslator } from "@/i18n/translate";

export default async function HomePage() {
  const { t } = createTranslator(await getRequestLocale());
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">{t("landing.eyebrow")}</span>
        <h1>FM Command</h1>
        <p>{t("landing.lead")}</p>
        <div className="actions">
          <Link className="button primary" href="/sign-in">{t("landing.signIn")}</Link>
          <Link className="button" href="/dashboard">{t("landing.open")}</Link>
        </div>
        <p className="phase">{t("landing.phase")}</p>
      </section>
    </main>
  );
}
