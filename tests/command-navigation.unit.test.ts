import { describe, expect, it } from "vitest";
import { commandNavigationForRole } from "@/presentation/command-navigation";

describe("FM Command navigation RBAC + tenant features", () => {
  it("expõe os módulos executivos comuns para todos os papéis com metric:read", () => {
    for (const role of ["owner", "admin", "analyst", "viewer", "member"] as const) {
      const items = commandNavigationForRole(role);
      const hrefs = items.map((item) => item.href);
      expect(hrefs).toContain("/dashboard/trials");
      expect(hrefs).toContain("/dashboard/subscriptions");
      expect(hrefs).toContain("/dashboard/settings");
      expect(hrefs).toContain("/dashboard/search");
      expect(hrefs).toContain("/dashboard/notifications");
      expect(hrefs).not.toContain("/dashboard/commercial/kordena");
    }
  });

  it("expõe Kordena somente quando a integração está habilitada no tenant", () => {
    for (const role of ["owner", "admin", "analyst", "viewer", "member"] as const) {
      const withoutKordena = commandNavigationForRole(role);
      const withKordena = commandNavigationForRole(role, {
        kordenaCommercial: true,
      });
      expect(
        withoutKordena.some(
          (item) => item.href === "/dashboard/commercial/kordena",
        ),
      ).toBe(false);
      expect(
        withKordena.some(
          (item) => item.href === "/dashboard/commercial/kordena",
        ),
      ).toBe(true);
    }
  });

  it("oculta administração de fontes de viewer/member", () => {
    for (const role of ["viewer", "member"] as const) {
      const items = commandNavigationForRole(role, {
        kordenaCommercial: true,
      });
      expect(items.some((item) => item.href === "/dashboard/sources")).toBe(false);
      expect(items.some((item) => item.href === "/dashboard/commercial/kordena")).toBe(true);
    }
  });

  it("mantém fontes visível para owner/admin/analyst", () => {
    for (const role of ["owner", "admin", "analyst"] as const) {
      expect(
        commandNavigationForRole(role).some(
          (item) => item.href === "/dashboard/sources",
        ),
      ).toBe(true);
    }
  });

  it("expõe Atividades somente para papéis com audit:read", () => {
    for (const role of ["owner", "admin", "analyst"] as const) {
      expect(
        commandNavigationForRole(role).some(
          (item) => item.href === "/dashboard/activity",
        ),
      ).toBe(true);
    }
    for (const role of ["viewer", "member"] as const) {
      expect(
        commandNavigationForRole(role).some(
          (item) => item.href === "/dashboard/activity",
        ),
      ).toBe(false);
    }
  });

  it("deriva cada item de uma permissão canônica", () => {
    for (const role of ["owner", "admin", "analyst", "viewer", "member"] as const) {
      const items = commandNavigationForRole(role, {
        kordenaCommercial: true,
      });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => Boolean(item.permission))).toBe(true);
    }
  });
});
