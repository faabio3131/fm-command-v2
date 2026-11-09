-- FM Command commercial billing authority: one-time IRON AI credits.
-- Separate from academy->student money and from recurring SaaS invoice cycles.
CREATE TABLE fmcc_iron_ai_credit_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  product_id uuid NOT NULL,
  gym_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  gateway_account_id uuid NOT NULL,
  package_code text NOT NULL,
  units integer NOT NULL,
  amount_minor integer NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  payment_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fmcc_iron_ai_order_units CHECK (units IN (100,300,1000)),
  CONSTRAINT fmcc_iron_ai_order_price CHECK (
    (package_code='IRON_AI_WORKOUT_100' AND units=100 AND amount_minor=1990) OR
    (package_code='IRON_AI_WORKOUT_300' AND units=300 AND amount_minor=4990) OR
    (package_code='IRON_AI_WORKOUT_1000' AND units=1000 AND amount_minor=12990)
  ),
  CONSTRAINT fmcc_iron_ai_order_currency CHECK (currency='BRL'),
  CONSTRAINT fmcc_iron_ai_order_status CHECK (status IN ('pending','paid','refunded')),
  CONSTRAINT fmcc_iron_ai_order_idempotency UNIQUE (tenant_id,product_id,gym_id,idempotency_key),
  CONSTRAINT fmcc_iron_ai_order_payment_unique UNIQUE (tenant_id,gateway_account_id,payment_ref),
  CONSTRAINT fmcc_iron_ai_order_product_fk FOREIGN KEY (tenant_id,product_id)
    REFERENCES fmcc_product_definition(tenant_id,id),
  CONSTRAINT fmcc_iron_ai_order_subscription_fk FOREIGN KEY (tenant_id,subscription_id,product_id,customer_id)
    REFERENCES fmcc_billing_subscription(tenant_id,id,product_id,customer_id),
  CONSTRAINT fmcc_iron_ai_order_gateway_fk FOREIGN KEY (tenant_id,gateway_account_id)
    REFERENCES fmcc_billing_gateway_account(tenant_id,id)
);
CREATE INDEX fmcc_iron_ai_order_gym_status_idx ON fmcc_iron_ai_credit_order(gym_id,status,created_at);

CREATE TABLE fmcc_iron_ai_credit_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES fmcc_iron_ai_credit_order(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  claim_token uuid,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  CONSTRAINT fmcc_iron_ai_outbox_event CHECK(event_type IN ('GRANT','REVOKE')),
  CONSTRAINT fmcc_iron_ai_outbox_status CHECK(status IN ('pending','processing','retry','delivered','blocked')),
  CONSTRAINT fmcc_iron_ai_outbox_once UNIQUE (order_id,event_type),
  CONSTRAINT fmcc_iron_ai_outbox_attempts CHECK(attempts BETWEEN 0 AND 12)
);
CREATE INDEX fmcc_iron_ai_outbox_ready_idx ON fmcc_iron_ai_credit_outbox(status,available_at);

CREATE TABLE fmcc_iron_ai_credit_provider_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES fmcc_iron_ai_credit_order(id) ON DELETE RESTRICT,
  payment_ref text NOT NULL,
  event_type text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fmcc_iron_ai_provider_event_once UNIQUE(order_id,event_type,payment_ref)
);
