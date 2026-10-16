import { describe, expect, it } from "vitest";
import { estimateFee, parseFeeSchedule, type FeeSchedule } from "@/domain/subscription/fee-schedule";

const base: FeeSchedule = { providerId: "banco_x", method: "boleto", currency: "BRL", fixedMinor: 349, percentBps: 0, minMinor: 0, maxMinor: null, effectiveFrom: new Date("2026-01-01T00:00:00Z") };

describe("taxa configuravel do meio de cobranca", () => {
  it("fixo: o boleto de um banco cobra valor por boleto", () => {
    expect(estimateFee(base, 4900, "BRL")).toEqual({ feeMinor: 349, netMinor: 4551, currency: "BRL" });
  });
  it("percentual em basis points, arredondando para o centavo mais proximo (meio para cima)", () => {
    const card = { ...base, method: "card" as const, fixedMinor: 49, percentBps: 299 }; // 2,99% + 0,49
    expect(estimateFee(card, 4900, "BRL")).toEqual({ feeMinor: 49 + 147, netMinor: 4900 - 196, currency: "BRL" }); // 146,51 -> 147
    expect(estimateFee({ ...base, fixedMinor: 0, percentBps: 50 }, 1, "BRL")?.feeMinor).toBe(0); // 0,005 -> arredonda para baixo? 0,005 centavo
    expect(estimateFee({ ...base, fixedMinor: 0, percentBps: 5000 }, 1, "BRL")?.feeMinor).toBe(1); // 0,5 -> 1
  });
  it("minimo e maximo limitam a taxa, e a taxa nunca passa do valor cobrado", () => {
    expect(estimateFee({ ...base, fixedMinor: 0, percentBps: 100, minMinor: 200 }, 4900, "BRL")?.feeMinor).toBe(200);
    expect(estimateFee({ ...base, fixedMinor: 0, percentBps: 1000, maxMinor: 300 }, 4900, "BRL")?.feeMinor).toBe(300);
    expect(estimateFee({ ...base, fixedMinor: 500 }, 300, "BRL")).toEqual({ feeMinor: 300, netMinor: 0, currency: "BRL" });
  });
  it("moeda diferente da tabela ou valor invalido = sem estimativa (nunca converte)", () => {
    expect(estimateFee(base, 4900, "USD")).toBeNull();
    expect(estimateFee(base, 0, "BRL")).toBeNull();
    expect(estimateFee(base, 1.5, "BRL")).toBeNull();
  });
  it("valida a configuracao", () => {
    const ok = { ...base };
    expect(parseFeeSchedule(ok).ok).toBe(true);
    for (const bad of [{ ...ok, method: "cheque" }, { ...ok, percentBps: 10001 }, { ...ok, fixedMinor: -1 }, { ...ok, currency: "XX" }, { ...ok, maxMinor: 1, minMinor: 5 }, { ...ok, providerId: "Banco X" }, { ...ok, effectiveFrom: "2026" }])
      expect(parseFeeSchedule(bad).ok).toBe(false);
  });
});
