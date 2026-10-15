export type GlobalSearchResultKind =
  | "navigation"
  | "metric"
  | "product"
  | "source"
  | "alert_rule"
  | "alert_occurrence"
  | "activity";

export interface GlobalSearchResult {
  readonly id: string;
  readonly kind: GlobalSearchResultKind;
  readonly label: string;
  readonly description: string;
  readonly href: string;
  readonly authority: string;
}

export interface GlobalSearchOverview {
  readonly query: string;
  readonly items: readonly GlobalSearchResult[];
  readonly counts: {
    readonly totalMatches: number;
    readonly returned: number;
    readonly navigation: number;
    readonly metrics: number;
    readonly products: number;
    readonly sources: number;
    readonly alertRules: number;
    readonly alertOccurrences: number;
    readonly activities: number;
  };
  readonly coverageNote: string;
}

export interface SearchRateLimiter {
  consume(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  }): Promise<void>;
}

export class GlobalSearchQueryError extends Error {
  constructor(message = "search.query_invalid") {
    super(message);
    this.name = "GlobalSearchQueryError";
  }
}

export class GlobalSearchRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 60) {
    super("search.rate_limited");
    this.name = "GlobalSearchRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
