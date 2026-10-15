# EXCEPTION-001 — Product-Owned FM Cognitive Vertical Core

**Status:** APPROVED  
**Date:** 20/09/2026  
**Product:** FM Control Center  
**Authority:** Product direction / FM Solution Architecture  
**Related:** Documento Mestre v2.0 §11, FMCC Documento 00, ADR-013

## 1. Institutional rule affected

The Nova FM Master Document defines the conceptual pattern:

**CORE COGNITIVO COMPARTILHADO**  
+ **CAPACIDADES ESPECÍFICAS DO PRODUTO/VERTICAL**  
+ **SERVIÇOS DETERMINÍSTICOS**  
+ **INTERFACES E INTEGRAÇÕES**

The FMCC foundation also required Current discovery before choosing the form of Core reuse.

## 2. Identified need

FM Control Center is a commercially independent multi-tenant SaaS. Nova FM is Tenant Zero, not a special internal edition.

A single operational cognitive runtime shared with another SaaS would create structural coupling in:
- release lifecycle;
- availability;
- memory/context;
- SLA;
- cost attribution;
- security boundaries;
- product evolution;
- incident blast radius;
- future commercial portability.

## 3. Approved exception

For FM Control Center, "shared cognitive core" will **not** mean one operational brain/runtime shared with Kordena, IRON or another SaaS.

FMCC will own its own **FM Cognitive Vertical Core**, including:
- vertical policies;
- context/memory;
- capability registry;
- grounding rules;
- cognitive orchestration;
- evaluation/guardrails;
- runtime lifecycle.

## 4. What remains shared

To preserve institutional reuse and avoid waste, Nova FM may share a reusable **FM Cognitive Foundation**, including:
- model-provider contracts;
- provider adapters;
- prompt/tooling primitives;
- audit/observability helpers;
- security helpers;
- evaluation harnesses;
- generic memory primitives;
- common protocol conventions.

Shared foundation components must not carry product-specific memory, tenant state or vertical business authority.

## 5. Authority boundaries

FMCC Core does not replace:
- Auth/Tenant authority;
- Metric Engine;
- Source Registry;
- Connector Runtime;
- Audit Ledger;
- Governed Action Services.

Pattern:

Core/IA
→ interpretation / analysis / recommendation
→ governed capability
→ deterministic authoritative service
→ validation / authorization
→ execution
→ audit

## 6. Consequences

Positive:
- true vertical cognition;
- product independence;
- tenant-context isolation;
- independent release and SLA;
- lower cross-product blast radius;
- commercial portability.

Cost:
- vertical Core code must be maintained per product;
- common primitives require disciplined extraction to avoid copy divergence.

## 7. Controls

- ADR-001 marked SUPERSEDED;
- ADR-013 accepted;
- cross-product FMCC runtime artifacts are being removed from `fm-ai-platform`;
- FMCC-owned Core is implemented inside `FM-CONTROL-CENTER`;
- production remains prohibited until normal gates are satisfied.

## 8. Approval basis

This exception is explicitly approved by product direction and documented rather than silently contradicting the Master Document.
