# T21 Disposable LLM Protocol Probe

Captured on 2026-08-23 with the externally configured `deepseek-v4-flash` profile. The temporary
probe used the same OpenAI-compatible provider adapter, `streamText`, system prompt builder, tools,
and 60-second abort behavior as the product. It sent only a bounded dual-focus read-only question
to the model endpoint, called no UI4A business HTTP endpoint, printed no credential, changed no
repository file, and deleted its temporary directory after completion.

## Results

| Mode | Sample | Result | Latency | Tool shape |
| --- | ---: | --- | ---: | --- |
| `auto` | 1 | `finishReason=tool-calls` | 5,136 ms | `answer(content,sources)` |
| `auto` | 2 | `finishReason=tool-calls` | 3,104 ms | `answer(content,sources)` |
| `required` | 1 | `finishReason=tool-calls` | 2,382 ms | `answer(content,sources)` |
| text-only → `required` repair | 1 | `finishReason=tool-calls` | 6,301 ms | `answer(content,sources)` |

`auto` produced one valid call in both fresh samples, so the small probe did not reproduce the
intermittent text-only failure seen in the Red baseline. The current provider accepted
`toolChoice:'required'` without the hang recorded for the superseded GLM profile. A `required`
response may still contain a small text delta alongside a valid tool call; protocol success must
therefore be determined by the validated tool call, not by requiring an empty text channel.

The repair sample injected the known text-only failure shape as the previous decision, disclosed
only the bounded protocol error, and made a second real LLM decision with the same facts and tools
under `required`. It returned a valid call without parsing or mechanically converting the rejected
text. This proves the repair shape is viable, not its long-run success rate.

## Decision input

Phase D should implement the following bounded policy unless the canonical-plus-variants gate
disproves it:

1. Use provider-native `toolChoice:'required'` for each production Assistant decision. This
   constrains the protocol envelope; it does not choose intent, subject, action, or tool for the
   model.
2. If the first result has no call, an unknown tool, or invalid arguments, make at most one second
   real LLM decision. Reuse the same bounded facts and current tools, disclose the validation class,
   and keep `required`.
3. Never parse text-only output into an operation. If the second decision remains invalid, return
   the existing honest fail-safe and zero business mutation.
4. Revalidate `required` across the canonical and four natural-language variants because this
   disposable probe contains one normal `required` sample and one repair sample, not a release-size
   corpus.

## Reproduction commands

```bash
node scripts/with-local-env.mjs node -e '<verify complete profile and print model name only>'
node scripts/with-local-env.mjs pnpm exec tsx /tmp/ui4a-t21-llm-probe.<random>/probe.ts
```

The temporary probe file is deliberately not retained as production or test code. Phase D will
express the selected behavior through injected-driver protocol tests and the real LLM acceptance
gate.
