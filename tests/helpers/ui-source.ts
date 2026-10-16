import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ptBR } from "../../src/i18n/messages/pt-BR";

const T_JSX = /\{t\(\s*"([A-Za-z0-9_.]+)"(?:\s*,\s*\{[^{}]*\})?\s*\)\}/g;
const T_CALL = /\bt\(\s*"([A-Za-z0-9_.]+)"(?:\s*,\s*\{[^{}]*\})?\s*\)/g;

function text(key: string): string | undefined {
  return (ptBR as Record<string, string>)[key];
}

/**
 * Lê o código de uma tela e mostra, ao lado de cada `t("chave")`, o texto em pt-BR do catálogo.
 * Os testes de contrato de tela afirmam "a tela mostra este texto"; com o texto nos catálogos (ADR-020),
 * a afirmação continua valendo sobre o texto que a pessoa vê, sem exigir texto fixo no componente.
 * A chamada original (chave e parâmetros) continua no código lido, em comentário, então afirmar "usa a chave X" ou "passa este valor" também funciona.
 */
export function readUiSource(path: string): string {
  let raw = readFileSync(resolve(process.cwd(), path), "utf8");
  // Telas de erro e carregamento usam componentes compartilhados; o marcado (aria-busy, role="alert") vive neles.
  if (raw.includes("RouteLoading")) raw += "\n" + readFileSync(resolve(process.cwd(), "src/app/dashboard/route-loading.tsx"), "utf8");
  if (raw.includes("RouteError")) raw += "\n" + readFileSync(resolve(process.cwd(), "src/app/dashboard/route-states.tsx"), "utf8");
  return raw
    .replace(T_JSX, (whole, key: string) => {
      const value = text(key);
      return value === undefined ? whole : `${value}{/* ${whole.slice(1, -1)} */}`;
    })
    .replace(T_CALL, (whole, key: string) => {
      const value = text(key);
      return value === undefined ? whole : `${JSON.stringify(value)} /* ${whole} */`;
    });
}
