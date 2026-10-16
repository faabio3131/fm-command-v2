"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslator } from "@/i18n/react/i18n-provider";
import { createLabels } from "@/presentation/labels";

type ProductCreateResponse = { error?: string };

async function responsePayload(response: Response): Promise<ProductCreateResponse> {
  try {
    return await response.json() as ProductCreateResponse;
  } catch {
    return {};
  }
}

export function ProductCreateForm() {
  const router = useRouter();
  const { t, locale } = useTranslator();
  const labels = createLabels(locale);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const slug = String(form.get("slug") ?? "").trim();
    if (!name || !slug) return;

    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        setStatus("error");
        setMessage(labels.productCreateError(payload.error));
        return;
      }

      formElement.reset();
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage(labels.productCreateError());
    }
  }

  return (
    <form className="product-create-form" onSubmit={submit}>
      <label>{t("products.create.name")}<input name="name" required minLength={2} maxLength={120} autoComplete="off" placeholder={t("products.create.namePlaceholder")} /></label>
      <label>{t("products.create.slug")}<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" autoComplete="off" placeholder="kordena" /></label>
      <button className="button" type="submit" disabled={status === "saving"}>{status === "saving" ? t("products.create.saving") : t("products.create.submit")}</button>
      {status === "error" ? <small className="error" role="alert">{message}</small> : null}
    </form>
  );
}
