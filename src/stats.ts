// Measurement core for the DSH-parity stats strip. Pure: no host access, so it can be
// replayed and unit-checked outside Command Code.

export type Usage = {
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cacheReadTokens?: number;
	readonly cacheWriteTokens?: number;
};

export type RequestSample = {
	readonly at: number;
	readonly model?: string;
	readonly effort?: string;
	readonly ttftMs?: number;
	readonly firstTextMs?: number;
	readonly spanMs?: number;
	readonly outputTokens?: number;
	readonly tps?: number;
	readonly inputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly cacheHit?: number;
	readonly retries: number;
	readonly untimed?: boolean;
};

export type Totals = {
	readonly turns: number;
	readonly steps: number;
	readonly llmMs: number;
	readonly toolMs: number;
	readonly ttftMs: number;
	readonly ttftSteps: number;
	readonly decodeMs: number;
	readonly decodeTokens: number;
};

export const zeroTotals = (): Totals => ({
	turns: 0,
	steps: 0,
	llmMs: 0,
	toolMs: 0,
	ttftMs: 0,
	ttftSteps: 0,
	decodeMs: 0,
	decodeTokens: 0,
});

/** Ratio of sums, never a mean of ratios. */
export function tpsOf(totals: Totals): number | undefined {
	if (totals.decodeMs <= 0 || totals.decodeTokens <= 0) return undefined;
	return totals.decodeTokens / (totals.decodeMs / 1000);
}

export function meanTtft(totals: Totals): number | undefined {
	return totals.ttftSteps > 0 ? totals.ttftMs / totals.ttftSteps : undefined;
}

/**
 * DSH's sessionStats definition, applied to the samples this mod keeps:
 * `step/end`-equivalent counts and wall times. `llmMs` here is the request span this
 * mod measured (start → end), `decodeMs/decodeTokens` the span → usage pair.
 */
export function applySample(totals: Totals, sample: RequestSample, newTurn: boolean): Totals {
	const measured = sample.tps !== undefined && sample.spanMs !== undefined && sample.outputTokens !== undefined;
	const llmMs = sample.spanMs !== undefined ? sample.spanMs : 0;
	return {
		turns: totals.turns + (newTurn ? 1 : 0),
		steps: totals.steps + 1,
		llmMs: totals.llmMs + llmMs,
		toolMs: totals.toolMs,
		ttftMs: totals.ttftMs + (sample.ttftMs ?? 0),
		ttftSteps: totals.ttftSteps + (sample.ttftMs !== undefined ? 1 : 0),
		decodeMs: totals.decodeMs + (measured ? (sample.spanMs as number) : 0),
		decodeTokens: totals.decodeTokens + (measured ? (sample.outputTokens as number) : 0),
	};
}

/**
 * Cache hit over the whole log. Command Code's buckets are disjoint — a real
 * transcript line reads {"inputTokens":74869,"cacheReadTokens":74752} — so the
 * denominator is their sum, exactly DSH's billedInputTokens.
 */
export function cacheHitOf(requests: readonly RequestSample[]): {hit?: number; billed: number; read: number; output: number} {
	let read = 0;
	let write = 0;
	let uncached = 0;
	let output = 0;
	for (const request of requests) {
		read += request.cacheReadTokens;
		write += request.cacheWriteTokens;
		uncached += request.inputTokens;
		output += request.outputTokens ?? 0;
	}
	const billed = uncached + read + write;
	return {hit: billed > 0 ? (read / billed) * 100 : undefined, billed, read, output};
}

/** Last request's cache hit is what the strip shows; the session aggregate is the tooltip. */
export function lastCacheHit(requests: readonly RequestSample[]): number | undefined {
	for (let index = requests.length - 1; index >= 0; index -= 1) {
		const hit = requests[index]?.cacheHit;
		if (hit !== undefined) return hit;
	}
	return undefined;
}

/** The answer text arrived in one late flush: timing it is impossible, not just noisy. */
export function isUntimed(firstTokenAt: number | undefined, firstTextAt: number | undefined, endedAt: number, deltas: number): boolean {
	if (firstTextAt === undefined) return false;
	const burst = deltas <= 2 && endedAt - firstTextAt < 250;
	return burst && (firstTokenAt === undefined || firstTokenAt === firstTextAt);
}
