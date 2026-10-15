import { describe, expect, it } from "vitest";
import type {
  ConnectorContext,
  SourceDefinition,
} from "@/domain/integration/contracts";
import {
  KordenaCommercialConnectorError,
} from "@/infrastructure/integration/kordena-commercial-connector";
import { KordenaBillingConnector } from "@/infrastructure/integration/kordena-billing-connector";

const source: SourceDefinition = {
  id: "source-kordena",
  tenantId: "tenant-fmcc",
  productId: "product-kordena",
  name: "Kordena Commercial",
  sourceType: "kordena-commercial-v1",
  authoritativeDomain: "commercial",
  status: "configured",
  syncMode: "pull",
  secretRef: "env:FMCC_KORDENA_CONTROL_PLANE_TOKEN",
  config: { baseUrl: "https://kordena.example.test" },
  mappingVersion: "kordena-commercial-v1",
};

const context: ConnectorContext = {
  tenantId: "tenant-fmcc",
  correlationId: "corr-billing",
  timeoutMs: 8_000,
};

function responseFor(path: string): unknown {
  if (path.endsWith("/configuration-options")) {
    return {
      provider_codes: ["MERCADO_PAGO_SUBSCRIPTIONS"],
      provider_options: [
        {
          provider_code: "MERCADO_PAGO_SUBSCRIPTIONS",
          credential_fields: [
            { key: "access_token", label: "Access Token", secret: true },
            { key: "webhook_secret", label: "Webhook Secret", secret: true },
          ],
        },
      ],
      legal_entity_types: [
        { value: "individual", label: "Pessoa Física" },
        { value: "company", label: "Pessoa Jurídica" },
      ],
      payment_methods: ["pix", "card"],
      environments: ["sandbox", "production"],
    };
  }
  if (path.endsWith("/provider-accounts")) return [];
  if (path.endsWith("/routing-policies")) return [];
  return { status: "accepted" };
}

describe("Command Kordena billing control", () => {
  it("reads provider/PF/PJ options from Kordena instead of hardcoding them", async () => {
    const seen: string[] = [];
    const connector = new KordenaBillingConnector(
      () => "x".repeat(40),
      async (input, init) => {
        const url = String(input);
        seen.push(url);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${"x".repeat(40)}`,
        );
        return new Response(JSON.stringify(responseFor(url)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      () => ["https://kordena.example.test"],
      () => "tenant-fmcc",
    );

    const overview = await connector.overview(context, source);

    expect(overview.options.provider_codes).toEqual([
      "MERCADO_PAGO_SUBSCRIPTIONS",
    ]);
    expect(overview.options.legal_entity_types).toEqual([
      { value: "individual", label: "Pessoa Física" },
      { value: "company", label: "Pessoa Jurídica" },
    ]);
    expect(overview.options.provider_options?.[0].credential_fields).toHaveLength(2);
    expect(seen).toEqual([
      "https://kordena.example.test/v1/control-plane/fmcc/billing/configuration-options",
      "https://kordena.example.test/v1/control-plane/fmcc/billing/provider-accounts",
      "https://kordena.example.test/v1/control-plane/fmcc/billing/routing-policies",
    ]);
  });

  it("forwards provider configuration with service token only in authorization", async () => {
    let seenBody = "";
    let seenAuthorization = "";
    let seenIdempotency = "";
    const connector = new KordenaBillingConnector(
      () => "s".repeat(40),
      async (_input, init) => {
        seenBody = String(init?.body ?? "");
        const headers = new Headers(init?.headers);
        seenAuthorization = headers.get("authorization") ?? "";
        seenIdempotency = headers.get("idempotency-key") ?? "";
        return new Response(JSON.stringify({ status: "draft" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      () => ["https://kordena.example.test"],
      () => "tenant-fmcc",
    );

    await connector.command(
      context,
      source,
      {
        actor: {
          user_id: "owner-1",
          role: "owner",
          step_up_at: "2026-10-03T00:00:00Z",
        },
        action: "provider.create",
        payload: {
          provider_code: "MERCADO_PAGO_SUBSCRIPTIONS",
          display_name: "Conta principal",
          legal_entity_type: "individual",
          legal_entity_ref: null,
          environment: "sandbox",
          supported_payment_methods: ["pix"],
          supports_recurring: true,
          supports_webhooks: true,
          priority: 100,
        },
      },
      "idem-billing-1",
    );

    expect(seenAuthorization).toBe(`Bearer ${"s".repeat(40)}`);
    expect(seenIdempotency).toBe("idem-billing-1");
    expect(seenBody).toContain('"legal_entity_type":"individual"');
    expect(seenBody).not.toContain("ssssssss");
  });

  it("forwards credential transiently without confusing it with the service token", async () => {
    const providerSecret = JSON.stringify({
      access_token: "provider-token-test",
      webhook_secret: "provider-webhook-test",
    });
    let seenBody = "";
    let seenAuthorization = "";
    const connector = new KordenaBillingConnector(
      () => "c".repeat(40),
      async (_input, init) => {
        seenBody = String(init?.body ?? "");
        seenAuthorization =
          new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
          JSON.stringify({ credential_configured: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      () => ["https://kordena.example.test"],
      () => "tenant-fmcc",
    );

    await connector.command(
      context,
      source,
      {
        actor: {
          user_id: "owner-1",
          role: "owner",
          step_up_at: "2026-10-03T00:00:00Z",
        },
        action: "provider.credential",
        resource_id: "provider-account-1",
        payload: {
          expected_version: 1,
          credential: providerSecret,
        },
      },
      "idem-credential-1",
    );

    expect(seenAuthorization).toBe(`Bearer ${"c".repeat(40)}`);
    expect(seenBody).toContain("provider-token-test");
    expect(seenBody).not.toContain("cccccccc");
  });

  it("fails closed outside the configured Command tenant", async () => {
    const connector = new KordenaBillingConnector(
      () => "x".repeat(40),
      async () => {
        throw new Error("network should not be reached");
      },
      () => ["https://kordena.example.test"],
      () => "tenant-fmcc",
    );

    await expect(
      connector.overview(
        { ...context, tenantId: "another-tenant" },
        { ...source, tenantId: "another-tenant" },
      ),
    ).rejects.toBeInstanceOf(KordenaCommercialConnectorError);
  });

  it("rejects origins outside the allowlist before forwarding secrets", async () => {
    const connector = new KordenaBillingConnector(
      () => "x".repeat(40),
      async () => {
        throw new Error("network should not be reached");
      },
      () => ["https://kordena.example.test"],
      () => "tenant-fmcc",
    );

    await expect(
      connector.overview(context, {
        ...source,
        config: { baseUrl: "https://attacker.example.test" },
      }),
    ).rejects.toThrow("integration.kordena_origin_not_allowed");
  });
});
