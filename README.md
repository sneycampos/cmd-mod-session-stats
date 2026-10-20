# cmd-mod-session-stats

Session stats for [Command Code](https://commandcode.ai) (`cmd`, `cmdc` on Windows):
turns, steps, **settled** tok/s, TTFT, prompt-cache hit and context, laid out like the
DeepSeek Harness stats strip.

```
◔ 4 turns 50 steps · 290 tok/s          ᖇ 3.2M tok · Cache hit 97% · 11%
```

Install:

```bash
cmd mods add cmd-mod-session-stats -g
```

Then `/cstats` opens the details pane, `/cstats reset` clears the samples, and
`/cstats context` prints what the host reports for context usage.

## How it differs from `cmdc-statusline`

`cmdc-statusline` is a broader status line and does its job well. This mod exists
because two of its figures are defined differently:

| | `cmdc-statusline` | this mod |
|---|---|---|
| tok/s | `outputTokens / (end − request_start)` — wall time, includes TTFT | `Σ outputTokens / Σ (end − first token)` — decode only |
| which request | the last one only | last request for the strip, session totals for the pane |
| cache hit | last request, `read / input` | `read / (input + read + write)` — disjoint buckets |
| turns / steps | — | counted and shown |
| unmeasurable requests | still reports a number | reported as `?`, excluded from the aggregate |

Both can be installed together; they draw different segments.

## What the numbers mean

- **tok/s** is computed once, at `model_request_end`, from provider-reported `outputTokens`.
  The span starts at the first *streamed* token, which includes reasoning, because the
  provider bills reasoning as output.
- **Untimed requests.** On some routes the answer text arrives as a single flush right
  before the request finishes. There is no per-token timing to measure then, so the
  request shows `?` and is excluded from the total instead of reporting a fantasy rate.
- **cache hit** accumulates over the session for the pane; the strip shows the last
  request. A near-miss never prints `100%`.
- **steps** counts model calls. DSH counts loop steps, and one step can hold several
  model calls, so this number runs higher for the same work.
- **turns** counts `run_start` events; Command Code has no turn boundaries to observe.
- **sub-agent tokens are not included**: sub-agents emit no `model_request_*` events.

## Look and feel

Strings and maths are taken from DeepSeek Harness 0.2.1-rc.2 (`stats.counts`,
`stats.cacheHit`, `sessionStats`, `tokenUsage`). The strip is split across the band above
the prompt and the status segment, because a mod cannot draw inside the composer. The
icon set is reproduced as monochrome Unicode glyphs — `◔` for the gauge and `ᖇ` for the
database — since a mod's element tree has no image node; the original SVG paths are in
`src/render.ts`.

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--mod-option sessionStatsSpeed=session` | `last` | `session` shows the session ratio instead of the last request |

`cmd mods disable session-stats` turns it off without uninstalling.

## Development

No build step: Command Code loads the TypeScript directly with jiti.

```bash
cmd --mod ./src/index.ts          # try it without installing
cmd mods inspect ./src/index.ts   # see every hook, command and capability it uses
```

`src/stats.ts` is pure and has no host dependency, so it can be exercised outside
Command Code.

## License

MIT
