# pi-claude-shimmer

> Claude Code-style working spinner for Pi — shimmer, thinking glow, token count, stall detection, and smooth animations.

[![npm version](https://img.shields.io/npm/v/pi-claude-shimmer?style=for-the-badge)](https://www.npmjs.com/package/pi-claude-shimmer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

## Why

Pi's built-in working indicator is functional but minimal. `pi-claude-shimmer` brings the same polished spinner experience from **Claude Code** to your Pi sessions:

- **Verb shimmer** — The verb text has a moving color sweep (shimmer), with different speed and direction depending on whether Pi is sending a request or receiving a response
- **Thinking timer** — Detects when the model is thinking, shows a glowing "thinking" label with a sine-wave shimmer (3s delay, like Claude Code), then transitions to "thought for Ns"
- **Token count** — Live `↓ N tokens` with smooth counter animation (no jumps)
- **Elapsed time** — Appears after 30s alongside the thinking/token status
- **Stall detection** — After 3s without new tokens, the verb smoothly transitions to red via color interpolation (not a hard binary switch)
- **Tool-use flash** — When tools are executing, the entire verb text oscillates between base and shimmer colors (sine wave)
- **Spinner ping-pong** — The spinner characters animate forward then backward (`· ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢`), matching Claude Code's animation
- **Completion notification** — Shows a brief `✻ Brewed for Ns` notification when the agent finishes

## Install

```bash
pi install npm:pi-claude-shimmer
```

Or install from GitHub:

```bash
pi install git:github.com/ouzhenkun/pi-claude-shimmer
```

## Usage

No configuration needed — the extension works automatically once installed. Just use Pi as normal.

### States

```
· Building…                                     ← requesting (no status yet)
✢ Crafting…  (thinking with high effort)        ← thinking (< 3s, no glow)
✳ Crafting…  (↓ 127 tokens · thinking)          ← thinking with tokens
✶ Cooking…   (↓ 1,234 tokens)                   ← responding (< 30s)
✻ Crunching… (32s · ↓ 3,678 tokens)             ← responding after 30s
✽ Brewing…   (1m 3s · ↓ 4,567 tokens)           ← tool-use (flash animation)
✻ Crunched for 2m 5s                            ← completion (notify)
```

## Features at a Glance

| Feature | Description |
|---------|-------------|
| **Verb shimmer** | Moving color sweep on verb text |
| **Request/respond arrows** | `↑` when sending, `↓` when receiving |
| **Thinking glow** | Sine-wave shimmer on "thinking" text after 3s |
| **Token counter** | Smooth animated `↓ N tokens` |
| **Elapsed timer** | Duration shown after 30s |
| **Tool-use flash** | Verb oscillates between colors during tool execution |
| **Stall detection** | Verb smoothly transitions to red after 3s without tokens |
| **Spinner ping-pong** | Characters animate forward then backward |
| **Completion notify** | Past-tense verb notification on finish |

## Dependencies

- `@earendil-works/pi-coding-agent` (peer)

## License

MIT
