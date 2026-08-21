# `allHandlersFinished`

> Always `await condition(allHandlersFinished)` before any workflow exit point —
> `continueAsNew`, `return`, or `throw` — to ensure every in-flight update handler
> delivers its response.

<!-- TODO: Full pattern writeup -->
