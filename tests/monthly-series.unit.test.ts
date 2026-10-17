import { describe, expect, it } from "vitest";
import { monthWindows } from "@/domain/metrics/monthly-series";

const SP = "America/Sao_Paulo";

describe("janelas de mês da série", () => {
  const now = new Date("2026-10-17T14:00:00Z");

  it("devolve do mais antigo ao mês corrente, com o corrente aberto até agora", () => {
    const w = monthWindows(now, SP, 3);
    expect(w.map((x) => x.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(w.map((x) => x.closed)).toEqual([true, true, false]);
    expect(w[2].periodEnd).toEqual(now);
  });

  it("usa o fuso da empresa: 1º de outubro à meia-noite em São Paulo é 03:00 UTC", () => {
    const w = monthWindows(now, SP, 2);
    expect(w[1].periodStart.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(w[0].periodStart.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("o fim de um mês fechado é 1 ms antes do início do seguinte, sem fato contado em dois meses", () => {
    const w = monthWindows(now, SP, 2);
    expect(w[0].periodEnd.getTime() + 1).toBe(w[1].periodStart.getTime());
  });

  it("atravessa a virada de ano", () => {
    const w = monthWindows(new Date("2027-02-10T12:00:00Z"), SP, 4);
    expect(w.map((x) => x.key)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("no fuso à frente do UTC, perto da virada, o mês é o local", () => {
    // 30/09 22:30 UTC já é 01/10 em Tóquio.
    const w = monthWindows(new Date("2026-09-30T22:30:00Z"), "Asia/Tokyo", 1);
    expect(w[0].key).toBe("2026-10");
  });

  it("recusa quantidade inválida", () => {
    expect(() => monthWindows(now, SP, 0)).toThrow("metrics.series_months_invalid");
    expect(() => monthWindows(now, SP, 25)).toThrow("metrics.series_months_invalid");
    expect(() => monthWindows(now, SP, 1.5)).toThrow("metrics.series_months_invalid");
  });
});
