import type { CoreEvidence } from "@/domain/core/contracts";
import type { TenantContext } from "@/domain/security/tenant-context";

export interface CoreReadCapabilityDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly productSlugs?: readonly string[];
}

export type CoreReadCapabilityResult =
  | {
      readonly status: "available";
      readonly fact: Record<string, unknown>;
      readonly evidence: CoreEvidence;
    }
  | {
      readonly status: "unavailable";
      readonly evidence: CoreEvidence;
    };

export interface CoreReadCapability {
  readonly descriptor: CoreReadCapabilityDescriptor;
  read(
    context: TenantContext,
    input: { readonly productSlugs: readonly string[] },
  ): Promise<CoreReadCapabilityResult>;
}

export class CoreReadCapabilityContractError extends Error {
  constructor() {
    super("core.read_capability_contract_invalid");
  }
}
