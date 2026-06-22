/**
 * Claude Code-style spinner for pi.
 *
 * Key behaviors (modeled after Claude Code):
 * - Verb is picked once per turn and stays fixed
 * - Spinner glyph changes: ↑ for requesting, ↓ for thinking/responding/tool-use
 * - Shimmer sweep across the verb text
 * - Status line: thinking state, token count, elapsed time
 * - Stall detection: verb turns red after 3s of no tokens
 * - Completion: "✻ Worked for Ns"
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ─── Types ────────────────────────────────────────────────────────

type SpinnerMode = "requesting" | "thinking" | "responding" | "tool-input" | "tool-use";

// ─── Verbs (curated, whimsical, present-continuous) ───────────────

const VERBS = [
  "Analyzing", "Architecting", "Baking", "Brewing", "Building",
  "Calculating", "Composing", "Computing", "Concocting", "Cooking",
  "Crafting", "Creating", "Crunching", "Debugging", "Deciphering",
  "Designing", "Developing", "Engineering", "Evaluating", "Examining",
  "Exploring", "Fixing", "Forging", "Generating", "Hatching",
  "Ideating", "Implementing", "Inspecting", "Investigating", "Optimizing",
  "Planning", "Pondering", "Processing", "Refactoring", "Researching",
  "Reviewing", "Ruminating", "Searching", "Solving", "Synthesizing",
  "Testing", "Thinking", "Tinkering", "Working", "Wrangling",
];

// Past tense verbs for turn completion messages (from Claude Code)
const COMPLETION_VERBS = [
  "Baked", "Brewed", "Churned", "Cogitated",
  "Cooked", "Crunched", "Sautéed", "Worked",
];

// ─── Glyphs ───────────────────────────────────────────────────────

// Claude-style spinner glyphs (same set for all modes)
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽"];
// Arrow prefix per mode: ↑ for requesting, ↓ for everything else
const ARROW_REQUESTING = "↑";
const ARROW_WORKING = "↓";

// Ping-pong spinner frames (forward then reverse, like Claude Code)
const SPINNER_FRAMES = [...GLYPHS, ...[...GLYPHS].reverse()];

// ─── ANSI Colors ──────────────────────────────────────────────────

const RESET = "\x1b[0m";
const ORANGE = "\x1b[38;2;215;119;87m";
const DIM = "\x1b[38;2;153;153;153m";
const RED = "\x1b[38;2;171;43;63m";

// ─── Timing Constants ─────────────────────────────────────────────

const SHIMMER_MS = 200;          // shimmer animation tick
const SHIMMER_BAND = 4;          // highlight band width in chars
const SHOW_TIMER_AFTER_MS = 30_000;
const THOUGHT_DISPLAY_MS = 3_500;
const STALL_TIMEOUT_MS = 3_000;
const STALL_ERROR_RED: [number, number, number] = [171, 43, 63];
const STALL_TRANSITION_FRAMES = 30;
const THINKING_GLOW_DELAY_MS = 3_000;
const THINKING_GLOW_PERIOD_MS = 2_000;
const THINKING_BASE_RGB: [number, number, number] = [153, 153, 153];
const THINKING_SHIMMER_RGB: [number, number, number] = [185, 185, 185];

// ─── Helpers ──────────────────────────────────────────────────────

function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]!;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

// ─── Shimmer Engine ───────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function blend(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Color-sweep: a moving highlight band across the verb text.
 * Returns ANSI-escaped string with per-character colors.
 */
function colorSweep(
  text: string,
  frame: number,
  baseHex: string,
  shimmerHex: string,
  reverse: boolean,
): string {
  const base = hexToRgb(baseHex);
  const shimmer = hexToRgb(shimmerHex);
  const total = text.length + SHIMMER_BAND * 2;
  const rawPos = frame % total;
  // Reverse: sweep right-to-left instead of left-to-right
  const pos = reverse ? total - 1 - rawPos : rawPos;

  let out = "";
  for (let i = 0; i < text.length; i++) {
    const dist = Math.abs(i - pos);
    const t = Math.max(0, 1 - dist / SHIMMER_BAND);
    const c = blend(base, shimmer, t);
    out += `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${text[i]}`;
  }
  out += RESET;
  return out;
}

// ─── Extension ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── State ───────────────────────────────────────────────────

  let mode: SpinnerMode = "requesting";
  let verb = "";
  let agentStart = 0;
  let turnStart = 0;
  let thinkingStart = 0;
  let thinkingDuration: number | null = null;
  let thoughtSetAt = 0;
  let responseLen = 0;
  let lastTokenTime = 0;
  let turnActive = false;
  let turnId = 0;
  let activeToolCount = 0;

  // Stall smooth interpolation (0→1)
  let _stallFrame = 0;
  // Token smooth animation
  let _displayedTokens = 0;

  // Timers
  let shimmerTimer: ReturnType<typeof setInterval> | null = null;
  let shimmerFrame = 0;
  let thoughtTimer: ReturnType<typeof setTimeout> | null = null;

  // State
  let ctx_: ExtensionContext | null = null;

  // ── Helpers ─────────────────────────────────────────────────

  function getEffortSuffix(): string {
    try {
      const level = pi.getThinkingLevel();
      if (!level || level === "off") return "";
      return ` with ${level} effort`;
    } catch {
      return "";
    }
  }

  function buildStatusParts(): string[] {
    const elapsed = Date.now() - (agentStart || turnStart);
    const tokens = Math.max(0, _displayedTokens);
    const parts: string[] = [];

    if (mode === "thinking" && thinkingDuration === null) {
      const thinkElapsed = Date.now() - thinkingStart;
      if (thinkElapsed > THINKING_GLOW_DELAY_MS) {
        // Sine-wave glow on "thinking" text (Claude Code style)
        const t = ((thinkElapsed - THINKING_GLOW_DELAY_MS) / 1000);
        const opacity = (Math.sin(t * Math.PI * 2 / (THINKING_GLOW_PERIOD_MS / 1000)) + 1) / 2;
        const c = blend(THINKING_BASE_RGB, THINKING_SHIMMER_RGB, opacity);
        parts.push(`\x1b[38;2;${c[0]};${c[1]};${c[2]}mthinking${getEffortSuffix()}\x1b[0m`);
      } else {
        parts.push(`thinking${getEffortSuffix()}`);
      }
    } else if (thinkingDuration !== null) {
      parts.push(`thought for ${Math.max(1, Math.round(thinkingDuration / 1000))}s`);
    }

    if (tokens > 0) {
      const arrow = mode === "requesting" ? ARROW_REQUESTING : ARROW_WORKING;
      parts.push(`${arrow} ${formatCount(tokens)} tokens`);
    }

    if (elapsed > SHOW_TIMER_AFTER_MS || thinkingDuration !== null || tokens > 0) {
      parts.push(formatDuration(elapsed));
    }

    return parts;
  }

  function isStalled(): boolean {
    return (
      mode !== "tool-use" &&
      mode !== "tool-input" &&
      activeToolCount === 0 &&
      turnActive &&
      lastTokenTime > 0 &&
      Date.now() - lastTokenTime > STALL_TIMEOUT_MS
    );
  }

  function buildShimmerMessage(): string {
    const parts = buildStatusParts();
    const reverse = mode !== "requesting";
    const baseHex = "#D77757";
    const shimmerHex = "#F0C0A0";
    const stalled = _stallFrame > 0;

    let verbText: string;

    if (mode === "tool-use") {
      // Flash effect: entire verb oscillates between base and shimmer (Claude Code style)
      const flashOpacity = (Math.sin((shimmerFrame * SHIMMER_MS / 1000) * Math.PI) + 1) / 2;
      if (stalled) {
        const stallT = _stallFrame / STALL_TRANSITION_FRAMES;
        const baseC = hexToRgb(baseHex);
        const stallC = blend(baseC, STALL_ERROR_RED, stallT);
        const flashC = blend(stallC, STALL_ERROR_RED, flashOpacity);
        verbText = `\x1b[38;2;${flashC[0]};${flashC[1]};${flashC[2]}m${verb}…\x1b[0m`;
      } else {
        const base = hexToRgb(baseHex);
        const shimmer = hexToRgb(shimmerHex);
        const c = blend(base, shimmer, flashOpacity);
        verbText = `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${verb}…\x1b[0m`;
      }
    } else if (stalled) {
      // Smooth stall: gradually blend to red
      const stallT = _stallFrame / STALL_TRANSITION_FRAMES;
      const baseC = hexToRgb(baseHex);
      const shimC = hexToRgb(shimmerHex);
      const stallBase = blend(baseC, STALL_ERROR_RED, stallT);
      const stallShimmer = blend(shimC, [220, 100, 100], stallT);
      const baseHexStr = `#${stallBase[0].toString(16).padStart(2,"0")}${stallBase[1].toString(16).padStart(2,"0")}${stallBase[2].toString(16).padStart(2,"0")}`;
      const shimmerHexStr = `#${stallShimmer[0].toString(16).padStart(2,"0")}${stallShimmer[1].toString(16).padStart(2,"0")}${stallShimmer[2].toString(16).padStart(2,"0")}`;
      verbText = colorSweep(verb, shimmerFrame, baseHexStr, shimmerHexStr, reverse);
    } else {
      verbText = colorSweep(verb, shimmerFrame, baseHex, shimmerHex, reverse);
    }

    let msg = verbText;
    if (parts.length > 0) {
      msg += ` ${DIM}(${parts.join(" · ")})${RESET}`;
    }
    return msg;
  }

  function updateDisplay() {
    if (!ctx_?.ui) return;
    ctx_.ui.setWorkingMessage(buildShimmerMessage());
  }

  function startShimmer() {
    stopShimmer();
    shimmerFrame = 0;
    updateDisplay();
    shimmerTimer = setInterval(() => {
      shimmerFrame++;
      // Stall smooth interpolation
      const stalled = isStalled();
      if (stalled && _stallFrame < STALL_TRANSITION_FRAMES) {
        _stallFrame++;
      } else if (!stalled && _stallFrame > 0) {
        _stallFrame--;
      }
      // Token smooth animation
      const target = Math.round(responseLen / 4);
      if (_displayedTokens < target) {
        const gap = target - _displayedTokens;
        const increment = gap < 70 ? 3 : gap < 200 ? Math.max(8, Math.ceil(gap * 0.15)) : 50;
        _displayedTokens = Math.min(_displayedTokens + increment, target);
      }
      updateDisplay();
    }, SHIMMER_MS);
  }

  function stopShimmer() {
    if (shimmerTimer) {
      clearInterval(shimmerTimer);
      shimmerTimer = null;
    }
  }

  function setGlyphs() {
    if (!ctx_?.ui) return;
    const intervalMs = mode === "requesting" ? 150 : 250;
    ctx_.ui.setWorkingIndicator({
      frames: SPINNER_FRAMES.map((g) => ORANGE + g + RESET),
      intervalMs,
    });
  }

  function setMode(newMode: SpinnerMode) {
    if (mode === newMode) return;
    mode = newMode;
    setGlyphs();
  }

  function onThinkingEnd() {
    if (thinkingDuration !== null) return;
    const dur = Date.now() - thinkingStart;
    thinkingDuration = dur;
    thoughtSetAt = Date.now();
    scheduleThoughtClear();
  }

  function scheduleThoughtClear() {
    if (thoughtTimer) clearTimeout(thoughtTimer);
    if (thinkingDuration === null) return;
    const remaining = THOUGHT_DISPLAY_MS - (Date.now() - thoughtSetAt);
    if (remaining <= 0) {
      thinkingDuration = null;
      updateDisplay();
      return;
    }
    thoughtTimer = setTimeout(() => {
      thoughtTimer = null;
      if (Date.now() - thoughtSetAt < THOUGHT_DISPLAY_MS) {
        scheduleThoughtClear();
        return;
      }
      thinkingDuration = null;
      updateDisplay();
    }, remaining);
  }

  function resetTurn() {
    stopShimmer();
    if (thoughtTimer) {
      clearTimeout(thoughtTimer);
      thoughtTimer = null;
    }
    ctx_?.ui?.setWorkingMessage();
    mode = "requesting";
    thinkingDuration = null;
    responseLen = 0;
    _stallFrame = 0;
    _displayedTokens = 0;
    lastTokenTime = 0;
    activeToolCount = 0;
    setGlyphs();
  }

  // ── Events ──────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ctx_ = ctx;
  });

  pi.on("agent_start", async (_event, ctx) => {
    ctx_ = ctx;
    if (!agentStart) agentStart = Date.now();
  });

  pi.on("turn_start", async (_event, ctx) => {
    ctx_ = ctx;
    turnId++;
    turnActive = true;
    turnStart = Date.now();
    if (!agentStart) agentStart = turnStart;
    verb = pickVerb();
    resetTurn();
    setMode("requesting");
    startShimmer();
  });

  pi.on("message_update", async (event, ctx) => {
    ctx_ = ctx;
    const evt = event.assistantMessageEvent;

    switch (evt.type) {
      case "thinking_start":
        setMode("thinking");
        thinkingStart = Date.now();
        thinkingDuration = null;
        if (thoughtTimer) {
          clearTimeout(thoughtTimer);
          thoughtTimer = null;
        }
        break;

      case "thinking_end":
        onThinkingEnd();
        break;

      case "text_start":
        if (mode !== "responding") {
          setMode("responding");
        }
        lastTokenTime = Date.now();
        break;

      case "text_delta":
        if (mode !== "responding") {
          setMode("responding");
        }
        lastTokenTime = Date.now();
        if (typeof evt.delta === "string") {
          responseLen += evt.delta.length;
        }
        break;

      case "text_end":
        if (typeof evt.content === "string") {
          responseLen = Math.max(responseLen, evt.content.length);
        }
        break;

      case "toolcall_start":
        setMode("tool-input");
        break;

      case "done":
        // Claude Code: message_stop switches to tool-use;
        // if no tools, just stay at responding
        if (activeToolCount > 0) {
          setMode("tool-use");
        }
        if (evt.message?.content) {
          responseLen = (evt.message.content as any[]).reduce(
            (s: number, b: any) =>
              s + (b.type === "text" && typeof b.text === "string" ? b.text.length : 0),
            0,
          );
        }
        break;
    }
  });

  pi.on("tool_execution_start", async (_event, ctx) => {
    ctx_ = ctx;
    activeToolCount++;
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    ctx_ = ctx;
    activeToolCount = Math.max(0, activeToolCount - 1);
    // After all tools finish, switch back to responding if the turn is still active
    if (activeToolCount === 0 && (mode === "tool-use" || mode === "tool-input") && turnActive) {
      setMode("responding");
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    ctx_ = ctx;
    turnActive = false;
    stopShimmer();

    if (thinkingDuration !== null && Date.now() - thoughtSetAt >= THOUGHT_DISPLAY_MS) {
      thinkingDuration = null;
    }

    responseLen = 0;
    activeToolCount = 0;
  });

  pi.on("agent_end", async () => {
    turnActive = false;
    stopShimmer();

    // Save elapsed before resetting turn state
    const elapsed = Date.now() - (turnStart || agentStart || Date.now());

    agentStart = 0;

    if (ctx_?.ui) {
      const verb = COMPLETION_VERBS[Math.floor(Math.random() * COMPLETION_VERBS.length)];
      const msg = `${DIM}✻ ${verb} for ${formatDuration(elapsed)}${RESET}`;
      ctx_.ui.notify(msg, "success");
    }
  });

  pi.on("session_shutdown", async () => {
    turnActive = false;
    stopShimmer();
    if (thoughtTimer) {
      clearTimeout(thoughtTimer);
      thoughtTimer = null;
    }
    ctx_ = null;
  });
}
