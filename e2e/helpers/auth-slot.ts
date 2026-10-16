import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * O servidor de produção limita cadastro e entrada a 3 pedidos por janela de 10 s por endereço (padrão do Better Auth), e o
 * limite está certo: não o desligamos para teste. A janela reinicia só depois de 10 s SEM pedidos (cada pedido aceito move o
 * último instante), então este registro imita o servidor: no máximo 3 pedidos, depois espera 10 s de silêncio.
 * O estado fica num arquivo para valer também entre arquivos de teste.
 */
const STATE = join(tmpdir(), "fmcc-e2e-auth-slots.json");
const WINDOW_MS = 10_500;
const LIMIT = 3;

interface State { count: number; last: number }

function read(): State {
  try { return existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as State) : { count: 0, last: 0 }; } catch { return { count: 0, last: 0 }; }
}

export async function waitForAuthSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    const state = read();
    const fresh = now - state.last > WINDOW_MS;
    const count = fresh ? 0 : state.count;
    if (count < LIMIT) {
      writeFileSync(STATE, JSON.stringify({ count: count + 1, last: now }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(200, WINDOW_MS - (now - state.last))));
  }
}
