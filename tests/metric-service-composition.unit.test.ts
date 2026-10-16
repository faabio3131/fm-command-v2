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

  it("nao ha import com apelido, heranca nem construcao reflexiva dessas classes fora da porta unica", () => {
    const door = ["src/application/metrics/metric-composition.ts"];
    expect(offenders(/import\s*\{[^}]*\b(MetricService|PostgresMetricStore)\b\s+as\s/, door)).toEqual([]);
    expect(offenders(/extends\s+(MetricService|PostgresMetricStore)\b/, door)).toEqual([]);
    expect(offenders(/Reflect\.construct|\bsql\.raw\s*\(/, [])).toEqual([]);
    // Import de valor so na porta unica; os demais usam `import type`.
    expect(offenders(/^import\s*\{[^}]*\b(MetricService|PostgresMetricStore)\b[^}]*\}\s*from/m, door)).toEqual([]);
  });

  it("a ingestao so ESCREVE fatos (nenhuma leitura nova em postgres-repositories)", () => {
    const text = files.find((f) => f.path === "src/infrastructure/integration/postgres-repositories.ts")!.text;
    // Invariante: as tabelas de fatos e valores so aparecem como alvo de INSERT. Citar as colunas dentro do
    // proprio INSERT (alvo e condicao do "atualiza se a origem for mais nova", etapa 8E) nao e leitura;
    // ler (from/join/query), atualizar ou apagar fora do INSERT continua proibido.
    const forbidden = /(from|innerJoin|leftJoin|rightJoin|fullJoin|update|delete)\(\s*(canonicalFacts|metricValues)\b|\bquery\.(canonicalFacts|metricValues)\b/;
    expect(text).not.toMatch(forbidden);
    const inserts = [...text.matchAll(/insert\(\s*(canonicalFacts|metricValues)\b/g)];
    expect(inserts.length).toBeGreaterThan(0);
    // Toda citacao da tabela fora do import tem de estar dentro de uma instrucao que comeca em insert(.
    const body = text.slice(text.indexOf("export class"));
    for (const m of body.matchAll(/\b(canonicalFacts|metricValues)\b/g)) {
      const head = body.slice(0, m.index!);
      const statementStart = Math.max(head.lastIndexOf("await db"), head.lastIndexOf("return db"));
      expect(body.slice(statementStart, m.index! + m[0].length)).toMatch(/insert\(\s*(canonicalFacts|metricValues)\b/);
    }
  });

  it("o armazenamento de metricas so e instanciado pela porta unica", () => {
    expect(offenders(/new PostgresMetricStore\s*\(/, ["src/application/metrics/metric-composition.ts"])).toEqual([]);
  });

  it("as tabelas de fatos e valores so sao lidas por arquivos conhecidos (armazenamento de metricas, feed de atividade com escopo, marca ao vivo com escopo, ingestao)", () => {
    const allowed = [
      "src/infrastructure/db/platform-schema.ts", "src/infrastructure/db/schema.ts",
      "src/infrastructure/metrics/postgres-metric-store.ts", "src/infrastructure/activity/postgres-activity-repository.ts",
      "src/infrastructure/integration/postgres-repositories.ts",
      // Etapa 10: marca de mudança ao vivo. Só lê o instante mais novo e exige o escopo (verificado no teste abaixo).
      "src/infrastructure/live/postgres-live-pulse-repository.ts",
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

  it("a marca de mudanca ao vivo exige o escopo e o aplica aos valores; auditoria so para quem enxerga tudo", () => {
    const repo = files.find((f) => f.path === "src/infrastructure/live/postgres-live-pulse-repository.ts")!.text;
    expect(repo).toMatch(/read\(tenantId: string, scope: UnitScope\)/);
    expect(repo).toContain("inArray(metricValues.unitId");
    expect(repo).toMatch(/scope\.kind === "all"\s*\?\s*db\.select\(\{ latest: max\(auditEvents/);
    expect(repo).not.toMatch(/\.select\(\)|canonicalFacts/);
  });
});
