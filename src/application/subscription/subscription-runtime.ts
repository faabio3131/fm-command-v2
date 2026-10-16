import { pool } from "@/infrastructure/db/client";
import { PostgresSubscriptionRepository } from "@/infrastructure/subscription/postgres-subscription-repository";
import { defaultProviderRegistry } from "@/infrastructure/subscription/provider-registry";
import { SubscriptionService } from "./subscription-service";

const g = globalThis as unknown as { fmccSubscriptionService?: SubscriptionService };

export function subscriptionService(): SubscriptionService {
  return (g.fmccSubscriptionService ??= new SubscriptionService(new PostgresSubscriptionRepository(pool), defaultProviderRegistry()));
}
