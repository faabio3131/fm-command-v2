import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-019 / etapa 9: nenhuma leitura de metrica ou de fato pode ignorar o escopo de unidades.
 * Estes testes leem o codigo-fonte e falham se alguem montar o servico "sem escopo" ou ler as tabelas por fora das portas permitidas.
 */
const ROOT = join(process.cwd(), "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const files = walk(ROOT).map((p) => ({ path: relative(process.cwd(), p).replaceAll("\\", "/"), text: readFileSync(p, "utf8") }));
const offenders = (re: RegExp, allowed: string[]) => files.filter((f) => re.test(f.text) && !allowed.includes(f.path)).map((f) => f.path);

describe("escopo de unidades em toda leitura de metricas e fatos", () => {
  it("o MetricService so e montado pela porta unica (que sempre passa o resolvedor de escopo)", () => {
    expect(offenders(/new MetricService\s*\(/, ["src/application/metrics/metric-composition.ts"])).toEqual([]);
    const composition = files.find((f) => f.path === "src/application/metrics/metric-composition.ts")!.text;
    expect(composition).toMatch(/new MetricService\(new PostgresMetricStore\(\), createUnitScopeResolver\(\)\)/);
  });

  it("o armazenamento de metricas so e instanciado pela porta unica", () => {
    expect(offenders(/new PostgresMetricStore\s*\(/, ["src/application/metrics/metric-composition.ts"])).toEqual([]);
  });

  it("as tabelas de fatos e valores so sao lidas por arquivos conhecidos (armazenamento de metricas, feed de atividade com escopo, ingestao)", () => {
    const allowed = [
      "src/infrastructure/db/platform-schema.ts", "src/infrastructure/db/schema.ts",
      "src/infrastructure/metrics/postgres-metric-store.ts", "src/infrastructure/activity/postgres-activity-repository.ts",
      "src/infrastructure/integration/postgres-repositories.ts",
    ];
    expect(offenders(/\b(canonicalFacts|metricValues)\b|fmcc_canonical_fact|fmcc_metric_value/, allowed)).toEqual([]);
  });

  it("a consulta do feed exige o escopo (campo obrigatorio no tipo) e o repositorio o aplica a fatos e auditoria", () => {
    const contract = files.find((f) => f.path === "src/domain/activity/contracts.ts")!.text;
    expect(contract).toMatch(/readonly unitScope: UnitScope;/);
    const repo = files.find((f) => f.path === "src/infrastructure/activity/postgres-activity-repository.ts")!.text;
    expect(repo).toContain("unitCondition");
    expect(repo).toMatch(/unitScope\.kind !== "all"\) return \[\]/);
  });
});
