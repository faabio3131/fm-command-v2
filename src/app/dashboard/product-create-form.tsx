"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { mensagemErroCadastroProduto } from "@/presentation/pt-br";

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
        setMessage(mensagemErroCadastroProduto(payload.error));
        return;
      }

      formElement.reset();
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Não foi possível cadastrar o produto.");
    }
  }

  return (
    <form className="product-create-form" onSubmit={submit}>
      <label>Produto<input name="name" required minLength={2} maxLength={120} autoComplete="off" placeholder="Ex.: Kordena" /></label>
      <label>Identificador<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" autoComplete="off" placeholder="kordena" /></label>
      <button className="button" type="submit" disabled={status === "saving"}>{status === "saving" ? "Salvando…" : "Cadastrar produto"}</button>
      {status === "error" ? <small className="error" role="alert">{message}</small> : null}
    </form>
  );
}
