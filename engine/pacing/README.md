# Readability pacing

`ReadabilityPacer` keeps a rendered frame visible long enough to read its prose.
It defaults to 250 words per minute (240 milliseconds per word), records the
deadline when `markRendered` is called, and lets provider/network latency consume
that budget before `waitUntilReadable` waits for any remainder.

```ts
import { ReadabilityPacer, renderedWorldText } from "./engine/pacing/index.js";

const pacer = new ReadabilityPacer();

await render(snapshot);
pacer.markRendered(renderedWorldText(snapshot));

const nextDecision = await provider.decide(context);
await pacer.waitUntilReadable();
applyDecision(nextDecision);
```

`renderedWorldText` matches the production renderer: it returns the latest
visible speech beat and active event summary. Apps with different presentation
rules can pass their own rendered strings directly to `markRendered`.

The clock and delay function are injectable for deterministic tests or host
platforms with custom scheduling. `remainingMs` can drive a countdown or status
message without starting a timer.
