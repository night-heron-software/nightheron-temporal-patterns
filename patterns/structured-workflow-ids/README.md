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
- **`entityId`** — the entity UUID or a reserved slug (e.g., `inventory.service`)

The delimiter is `.` (dot) — chosen because it cannot appear in a UUID or a domain name,
making parsing unambiguous.

### The builder function

```typescript
export type WorkflowDomain =
  | 'cart'
  | 'checkout'
  | 'oms'
  | 'fulfillment'
  | 'inventory'
  | 'identity';

export function buildWorkflowId(
  tenantId: string,
  domain: WorkflowDomain,
  entityId: string,
): string {
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
    entityId: parts.slice(2).join('.'),
  };
}
```

### Correlation at start time

Pair the ID builder with a start-options builder that attaches correlation search
attributes and memo at every workflow start:

```typescript
export function buildWorkflowStartOptions(params: {
  tenantId: string;
  domain: WorkflowDomain;
  entityId: string;
  correlationId?: string;
  orderId?: string;
  cartId?: string;
}): WorkflowStartOptions {
  return {
    workflowId: buildWorkflowId(params.tenantId, params.domain, params.entityId),
    searchAttributes: {
      TenantId: [params.tenantId],
      Domain: [params.domain],
      ...(params.correlationId && { CorrelationId: [params.correlationId] }),
      ...(params.orderId && { OrderId: [params.orderId] }),
      ...(params.cartId && { CartId: [params.cartId] }),
    },
    memo: {
      tenantId: params.tenantId,
      domain: params.domain,
      entityId: params.entityId,
    },
  };
}
```

### Enforcement

Ban inline workflow ID construction with an ESLint `no-restricted-syntax` rule that
matches template literals between two interpolations containing "workflow" or "Id":

```javascript
// eslint.config.js
{
  rules: {
    'no-restricted-syntax': ['error', {
      selector: 'TemplateLiteral[expressions.length>=2]',
      message: 'Build workflow IDs with buildWorkflowId(), never inline.',
    }],
  },
}
```

This is intentionally broad — it flags any template with two or more interpolations as
a candidate. The message directs the developer to the builder. A tighter selector
targeting specific variable names is possible but fragile.

## Example

**Starting a child workflow with correlation:**

```typescript
import { startChild } from '@temporalio/workflow';
import { buildWorkflowStartOptions } from './contracts';

const start = buildWorkflowStartOptions({
  tenantId: 'store-001',
  domain: 'fulfillment',
  entityId: orderId,
  orderId,
  cartId,
  correlationId: cartId,
});

await startChild('fulfillmentWorkflow', {
  ...start,
  args: [fulfillmentInput],
  taskQueue: 'fulfillment-queue',
  parentClosePolicy: 'ABANDON',
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

1. **Reserve search attribute names early.** Custom search attributes must be registered
   with the Temporal server before workflows can write to them. Add new attributes in
   both the contracts file and the server's registration script atomically.

2. **Singleton workflows use reserved slugs, not UUIDs.** An inventory service workflow
   that runs once per tenant uses `buildWorkflowId('store-001', 'inventory', 'service')`
   — the `entityId` is a well-known slug, not a generated UUID. Document the reserved
   slugs in the contracts file.

3. **`parseWorkflowId` must handle dots in entity IDs.** If a future entity ID format
   includes dots, the parser must `join` the remaining parts rather than assuming exactly
   three segments. The example above handles this with `parts.slice(2).join('.')`.

4. **Don't spread `buildWorkflowStartOptions` into `signalWithStart`.** The start
   options shape differs from the signal options shape. Use the builder for `start`,
   `startChild`, `executeChild`, and `WithStartWorkflowOperation`; build signal options
   separately.

## References

- [Temporal Workflow IDs — Best Practices](https://docs.temporal.io/workflows#workflow-id)
- [Temporal Search Attributes](https://docs.temporal.io/visibility#search-attribute)
- [`updateWithStart`](../update-with-start/) — uses the same ID builder for atomic lazy creation
- [`allHandlersFinished`](../all-handlers-finished/) — lifecycle protection at the same exit points
