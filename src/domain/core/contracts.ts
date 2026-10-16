export interface CoreEvidence {
  readonly kind: "metric" | "source";
  readonly ref: string;
  readonly productId?: string;
  readonly productSlug?: string;
  readonly sourceAuthority?: string;
  readonly freshnessStatus?: string;
  readonly qualityStatus?: string;
  readonly provenanceRefs?: readonly string[];
  readonly periodStart?: string;
  readonly periodEnd?: string;
  readonly asOf?: string;
}

export interface CoreOperationalContext {
  readonly question: string;
  readonly answer: string;
  readonly factualStatus: "grounded" | "unavailable";
  readonly evidenceRefs: readonly string[];
  readonly occurredAt?: string;
}

export interface CoreAnswer {
  readonly answer: string;
  readonly evidence: readonly CoreEvidence[];
  readonly factualStatus: "grounded" | "unavailable";
}
