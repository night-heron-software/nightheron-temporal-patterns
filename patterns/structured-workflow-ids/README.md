# Structured Workflow IDs

> Build workflow IDs from a parseable, predictable convention — never assemble the
> string inline.

## Problem

Temporal workflow IDs are arbitrary strings. Without a convention, IDs proliferate in
unpredictable formats: bare UUIDs (`a3f2b1c4-...`), prefixed strings
(`cart-a3f2b1c4-...`), composite keys with inconsistent delimiters
(`order_123_fulfillment`). This creates three problems:

1. **Deriving a handle requires a lookup.** If you know a cart's entity ID, you cannot
   construct the workflow ID without querying something — a database, a mapping table,
   or the Temporal server's search attributes.

2. **No structural correlation.** Given a workflow ID, you cannot extract the domain or
   tenant without parsing an undocumented format that varies per domain.

3. **Inline construction drifts.** When workflow IDs are assembled at each call site
   with template literals, the format inevitably diverges — one site uses a hyphen, another
   uses a dot, a third forgets the tenant prefix.

## Solution

Define a single, parseable ID format and enforce it through one builder function:

```
{tenantId}.{domain}.{entityId}
```

- **`tenantId`** — the tenant or namespace (e.g., `store-001`, `demo`)
- **`domain`** — the workflow's business domain (e.g., `cart`, `checkout`, `fulfillment`)
- **`entityId`** — the entity UUID or a reserved slug (e.g., `service`, `inventory.service`)

The delimiter is `.` (dot). The parsing rule that makes it unambiguous: **dots may appear
only in the final segment.** `tenantId` and `domain` are dot-free identifiers (the builder
rejects anything else), so the parser splits off the first two segments and treats
everything after the second dot as the entity ID.

### The builder function

```typescript
export type WorkflowDomain =
  | 'cart'
  | 'checkout'
  | 'oms'
  | 'fulfillment'
  | 'inventory'
  | 'identity';

const DOT_FREE = /^[A-Za-z0-9_-]+$/;

export function buildWorkflowId(
  tenantId: string,
  domain: WorkflowDomain,
  entityId: string,
): string {
  if (!DOT_FREE.test(tenantId)) {
    throw new Error(`tenantId must not contain '.': ${tenantId}`);
  }
  if (entityId.length === 0) {
    throw new Error('entityId must not be empty');
  }
  return `${tenantId}.${domain}.${entityId}`;
}

export function parseWorkflowId(workflowId: string): {
  tenantId: string;
  domain: string;
  entityId: string;
} {
  const parts = workflowId.split('.');
  if (parts.length < 3) {
    throw new Error(`Invalid workflow ID format: ${workflowId}`);
  }
  return {
    tenantId: parts[0],
    domain: parts[1],
    entityId: parts.slice(2).join('.'),   // dots are legal here and only here
  };
}
```

### Correlation at start time

Pair the ID builder with a start-options builder that attaches correlation search
attributes and memo at every workflow start. Use **typed** search attributes —
`defineSearchAttributeKey` + `typedSearchAttributes` — the untyped `searchAttributes`
option is deprecated in the TypeScript SDK:

```typescript
import { defineSearchAttributeKey, SearchAttributeType } from '@temporalio/common';
import type { SearchAttributePair } from '@temporalio/common';

// One place declares every custom search attribute the application writes.
export const TenantIdKey      = defineSearchAttributeKey('TenantId',      SearchAttributeType.KEYWORD);
export const DomainKey        = defineSearchAttributeKey('Domain',        SearchAttributeType.KEYWORD);
export const CorrelationIdKey = defineSearchAttributeKey('CorrelationId', SearchAttributeType.KEYWORD);
export const OrderIdKey       = defineSearchAttributeKey('OrderId',       SearchAttributeType.KEYWORD);
export const CartIdKey        = defineSearchAttributeKey('CartId',        SearchAttributeType.KEYWORD);

export interface WorkflowStartIdentity {
  workflowId: string;
  typedSearchAttributes: SearchAttributePair[];
  memo: Record<string, string>;
}

export function buildWorkflowStartOptions(params: {
  tenantId: string;
  domain: WorkflowDomain;
  entityId: string;
  correlationId?: string;
  orderId?: string;
  cartId?: string;
}): WorkflowStartIdentity {
  const typedSearchAttributes: SearchAttributePair[] = [
    { key: TenantIdKey, value: params.tenantId },
    { key: DomainKey, value: params.domain },
  ];
  if (params.correlationId) typedSearchAttributes.push({ key: CorrelationIdKey, value: params.correlationId });
  if (params.orderId)       typedSearchAttributes.push({ key: OrderIdKey, value: params.orderId });
  if (params.cartId)        typedSearchAttributes.push({ key: CartIdKey, value: params.cartId });

  return {
    workflowId: buildWorkflowId(params.tenantId, params.domain, params.entityId),
    typedSearchAttributes,
    memo: {
      tenantId: params.tenantId,
      domain: params.domain,
      entityId: params.entityId,
    },
  };
}
```

The returned object spreads into both client start options and `startChild` /
`executeChild` options — they share the same `workflowId`, `typedSearchAttributes`, and
`memo` fields.

### Enforcement

Ban inline workflow ID construction with an ESLint `no-restricted-syntax` rule. Target
the *places a workflow ID is assigned* rather than every template literal in the codebase
— a rule on `TemplateLiteral[expressions.length>=2]` fires on every log line and gets
disabled within a week:

```javascript
// eslint.config.js
{
  files: ['src/**/client/**/*.ts', 'src/**/workflows.ts', 'src/**/workflows/**/*.ts'],
  rules: {
    'no-restricted-syntax': ['error', {
      selector: ':matches(VariableDeclarator[id.name=/[wW]orkflowId$/], Property[key.name="workflowId"]) > TemplateLiteral',
      message: 'Build workflow IDs with buildWorkflowId(), never inline.',
    }],
  },
}
```

This catches `const workflowId = \`...\`` and `{ workflowId: \`...\` }` — the two shapes
that matter — and ignores everything else. It will not catch an ID built in a helper
with an unrelated name; the `files` scope and code review cover that remainder.

## Example

**Starting a child workflow with correlation:**

```typescript
import { startChild, ParentClosePolicy } from '@temporalio/workflow';
import { buildWorkflowStartOptions } from './contracts';

const start = buildWorkflowStartOptions({
  tenantId: 'store-001',
  domain: 'fulfillment',
  entityId: orderId,
  orderId,
  cartId,
  correlationId: cartId,
});

await startChild(fulfillmentWorkflow, {
  ...start,
  args: [fulfillmentInput],
  taskQueue: 'fulfillment-queue',
  parentClosePolicy: ParentClosePolicy.ABANDON,
});
```

**Deriving a handle from known components (no lookup):**

```typescript
const workflowId = buildWorkflowId('store-001', 'cart', cartId);
const handle = client.workflow.getHandle(workflowId);
const cart = await handle.query(getCartQuery);
```

**Querying by correlation in the Temporal UI:**

```
TenantId = "store-001" AND Domain = "fulfillment" AND OrderId = "abc-123"
```

## Provenance

The structured ID convention is a first-party pattern, not derived from the SDK docs or
samples. The SDK treats workflow IDs as opaque strings. The motivation came from three
operational pain points:

1. Debugging required searching Temporal's workflow list with partial text matches,
   because IDs were UUIDs with no structural meaning.
2. Cross-domain workflow communication (`getExternalWorkflowHandle`) required passing
   full workflow IDs through signal payloads, because the receiving workflow couldn't
   derive the ID from the entity ID alone.
3. Multi-tenant applications needed tenant isolation in workflow queries, which required
   search attributes even for simple "find this tenant's workflow" operations.

The dot delimiter and the `buildWorkflowId`/`parseWorkflowId` pair solved all three
simultaneously: structured IDs are self-describing, derivable, and tenant-scoped.

## Gotchas

1. **Register search attribute keys on the server before writing them.** Custom search
   attributes must exist in the namespace (`temporal operator search-attribute create
   --name TenantId --type Keyword`) before a workflow start can set them. Add new keys to
   the contracts file and the namespace-setup script atomically; a start with an
   unregistered key fails.

2. **Singleton workflows use reserved slugs, not UUIDs.** An inventory service workflow
   that runs once per tenant uses `buildWorkflowId('store-001', 'inventory', 'service')`
   — the `entityId` is a well-known slug, not a generated UUID. Document the reserved
   slugs in the contracts file.

3. **Only the last segment may contain dots.** `parseWorkflowId` joins everything after
   the second dot back together, so `store-001.inventory.eu.service` parses correctly —
   but a tenant ID with a dot would silently shift every segment. The builder rejects it;
   keep that check.

4. **Don't spread `buildWorkflowStartOptions` into `signalWithStart`.** The start
   options shape differs from the signal options shape. Use the builder for `start`,
   `startChild`, `executeChild`, and `WithStartWorkflowOperation`; build signal options
   separately.

## References

- [Temporal Workflow IDs — Best Practices](https://docs.temporal.io/workflows#workflow-id)
- [Temporal Search Attributes](https://docs.temporal.io/visibility#search-attribute)
- [`updateWithStart`](../update-with-start/) — uses the same ID builder for atomic lazy creation
- [Enforcement Mechanisms](../../reference/enforcement-mechanisms.md) — where the lint rule above fits
