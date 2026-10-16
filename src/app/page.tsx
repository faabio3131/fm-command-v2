import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">FM Tecnologia · Intelligence Control Plane</span>
        <h1>FM Command</h1>
        <p>
          Centro executivo governado para métricas, produtos, operações, alertas e decisões assistidas pelo
          FM Cognitive Vertical Core.
        </p>
        <div className="actions">
          <Link className="button primary" href="/sign-in">Entrar com segurança</Link>
          <Link className="button" href="/dashboard">Abrir FM Command</Link>
        </div>
        <p className="phase">Preview governado · mesma linha arquitetural destinada à operação comercial</p>
      </section>
    </main>
  );
}
