// cmd-mod-session-stats — the DeepSeek Harness stats strip, in Command Code:
//     ◔ 4 turns 50 steps · 290 tok/s      ᖇ 3.2M tok · Cache hit 97%  ◔ 11%
//
// WHERE EACH PIECE OF THE LOOK COMES FROM (DSH 0.2.1-rc.2, shipped bundles)
//   strings  "stats.counts" = "{turns} turns {steps} steps"
//            "stats.cacheHit" = "Cache hit {percent}%"
//            "{tps} tok/s", "{total} tok", "{percent}%"      (dsh-client-ui-chat)
//   tones    tertiary label, tabular numerals, 13px pill     (OpZ85W_* footer pill)
//   maths    tps = ΣoutputTokens / ΣdecodeMs;  cache = ΣcacheRead / ΣbilledInput;
//            billed = input + cacheRead + cacheWrite (disjoint buckets)   (stats.ts)
//   icons    IconGaugeOutlineRegular, IconDatabaseOutlineRegular, the ContextMeter
//            ring and the loading arc live verbatim in render.ts as SVG markup.
//
// THE HONEST LIMIT ON THE ICONS: a mod's element tree has no image node, so an SVG
// cannot be drawn. Every 16x16 outline icon in the DSH set has a block-or-geometric
// Unicode counterpart, and that counterpart is what renders here: ◔ (gauge + needle)
// and ᖇ (stacked database rings). It is the same icon design in monochrome text, not
// the same file. render.ts keeps the exact path data for anyone whose host can draw it.
//
// WHAT IS NOT PIXEL-IDENTICAL, AND WHY
//   - The strip is split: the left half is a band ABOVE the prompt (cmd.ui.widget),
//     the right half is the status segment. The composer is host-owned; a mod cannot
//     draw inside it.
//   - `steps` counts model calls here. DSH counts `step/end` boundaries, and one DSH
//     step can hold several model calls (tool round-trips), so this number runs higher
//     than DSH's for the same work.
//   - `turns` counts run_start events — Command Code has no turn_start/turn_end.
//   - Sub-agents emit no model_request_* (verified on 1.85.1), so their tokens are
//     absent, as they are from DSH's main-session figure.
//   - The context ring renders only when cmd.getContextUsage() reports a percent;
//     `/cstats context` prints exactly what it returns so you can see why it is missing.
//
// SURFACES
//   band above the prompt : gauge + turns/steps + settled tok/s
//   status segment        : db + total tokens + cache hit + context %
//   /cstats               : the DSH "Session statistics" dialog, as a pane
//   /cstats reset         : clear the session samples
//   /cstats context       : print what cmd.getContextUsage() returns
//
// Load with: cmd mods add cmd-mod-session-stats -g
// (published under that npm name; the mod itself is `session-stats`)

import type {ModApi} from '@commandcode/harness';
import {
	DATABASE_GLYPH,
	formatCacheHit,
	formatCompactTokens,
	formatDuration,
	formatSpeed,
	GAUGE_GLYPH,
} from './render.ts';
import {
	applySample,
	cacheHitOf,
	isUntimed,
	lastCacheHit,
	meanTtft,
	zeroTotals,
	tpsOf,
	type RequestSample,
	type Totals,
	type Usage,
} from './stats.ts';

type ModelEvent = {
	readonly model?: string;
	readonly effort?: string;
	readonly usage?: Usage;
};

const MAX_SAMPLES = 2000;

export default function (cmd: ModApi): void {
	cmd.addFlag('sessionStatsSpeed', {
		type: 'string',
		default: 'last',
		description: 'strip speed: last request (last) or session ratio (session)',
	});
	let samples: RequestSample[] = [];
	let totals: Totals = zeroTotals();
	let startMs = 0;
	let firstTokenAt: number | undefined;
	let firstTextAt: number | undefined;
	let textDeltas = 0;
	let retries = 0;
	let awaitingToken = false;
	let awaitingText = false;
	let lastTurnKey = '';

	const paint = (): void => {
		updateStatus();
		try {
			cmd.ui.refreshWidgets();
		} catch {
			// headless: nothing to repaint
		}
	};

	const turnKey = (): string => String(cmd.state.get('turn') ?? 0);

	const speed = (): number | undefined => {
		const last = samples[samples.length - 1];
		// Flag values live in one process-wide table keyed by name, so every mod
		// flag this package registers carries a `sessionStats` prefix.
		if (cmd.getFlag('sessionStatsSpeed') === 'session') return tpsOf(totals);
		return last?.tps;
	};

	// ── the second half of the strip: usage pill + context ring ─────────────────
	// Undefined until the first settled request: never repaint an empty 'Cache hit'.
	const statusLine = (): string | undefined => {
		if (samples.length === 0) return undefined;
		const aggregate = cacheHitOf(samples);
		const cache = lastCacheHit(samples);
		const total = aggregate.billed + aggregate.output;
		const parts = [`${DATABASE_GLYPH} ${formatCompactTokens(total)} tok`];
		if (cache !== undefined) parts.push(`Cache hit ${formatCacheHit(cache)}%`);
		const usage = contextUsage();
		if (usage !== undefined) parts.push(`${Math.round(usage.percent)}%`);
		const text = parts.join(' \u00b7 ');
		return text;
	};

	const updateStatus = (): void => {
		const text = statusLine();
		if (text === undefined) return;
		try {
			cmd.ui.setStatus(text);
		} catch {
			// no status surface (headless)
		}
	};

	const contextUsage = (): {tokens: number; contextWindow: number; percent: number} | undefined => {
		try {
			const usage = (cmd as unknown as {getContextUsage?: () => unknown}).getContextUsage?.() as
				| {tokens?: number | null; contextWindow?: number | null; percent?: number | null}
				| undefined;
			if (!usage || typeof usage.tokens !== 'number' || typeof usage.percent !== 'number') return undefined;
			if (usage.percent <= 0) return undefined;
			return {tokens: usage.tokens, contextWindow: usage.contextWindow ?? 0, percent: usage.percent};
		} catch {
			return undefined;
		}
	};

	// ── events ──────────────────────────────────────────────────────────────────
	cmd.on('run_start', () => {
		cmd.state.set('turn', (cmd.state.get<number>('turn') ?? 0) + 1);
	});

	cmd.on('model_request_start', () => {
		startMs = Date.now();
		firstTokenAt = undefined;
		firstTextAt = undefined;
		textDeltas = 0;
		retries = 0;
		awaitingToken = true;
		awaitingText = true;
	});

	cmd.on('thinking_delta', raw => {
		if (!awaitingToken) return;
		const delta = (raw as {delta?: unknown}).delta;
		if (typeof delta !== 'string' || delta.length === 0) return;
		awaitingToken = false;
		firstTokenAt = Date.now();
	});

	cmd.on('text_delta', raw => {
		textDeltas += 1;
		const delta = (raw as {delta?: unknown}).delta;
		const empty = typeof delta !== 'string' || delta.length === 0;
		if (!awaitingText) return;
		awaitingText = false;
		firstTextAt = empty ? undefined : Date.now();
		if (!awaitingToken && !empty) {
			awaitingToken = false;
			firstTokenAt = Date.now();
		}
	});

	cmd.on('api_retry', () => {
		retries += 1;
	});

	cmd.on('model_request_end', raw => {
		const data = raw as unknown as ModelEvent;
		const endedAt = Date.now();
		awaitingToken = false;
		awaitingText = false;
		const usage = data.usage ?? {};
		const untimed = isUntimed(firstTokenAt, firstTextAt, endedAt, textDeltas);
		const spanMs = firstTokenAt !== undefined ? Math.max(0, endedAt - firstTokenAt) : undefined;
		const outputTokens = usage.outputTokens;
		const tps =
			!untimed && outputTokens !== undefined && outputTokens > 0 && spanMs !== undefined && spanMs > 0
				? outputTokens / (spanMs / 1000)
				: undefined;
		const sample: RequestSample = {
			at: endedAt,
			...(typeof data.model === 'string' ? {model: data.model} : {}),
			...(typeof data.effort === 'string' ? {effort: data.effort} : {}),
			...(firstTokenAt !== undefined ? {ttftMs: Math.max(0, firstTokenAt - startMs)} : {}),
			...(firstTextAt !== undefined ? {firstTextMs: Math.max(0, firstTextAt - startMs)} : {}),
			...(spanMs !== undefined ? {spanMs} : {}),
			...(outputTokens !== undefined ? {outputTokens} : {}),
			...(tps !== undefined ? {tps} : {}),
			inputTokens: usage.inputTokens ?? 0,
			cacheReadTokens: usage.cacheReadTokens ?? 0,
			cacheWriteTokens: usage.cacheWriteTokens ?? 0,
			// 0% is a real reading (a route that billed input with no cache reads), not a
			// missing one, so it must be stored; absence means "nothing billed".
			...(() => {
				const hit = cacheHitOf([
					{
						at: endedAt,
						inputTokens: usage.inputTokens ?? 0,
						cacheReadTokens: usage.cacheReadTokens ?? 0,
						cacheWriteTokens: usage.cacheWriteTokens ?? 0,
						retries: 0,
					},
				]).hit;
				return hit !== undefined ? {cacheHit: hit} : {};
			})(),
			retries,
			...(untimed ? {untimed: true} : {}),
		};
		samples.push(sample);
		if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
		const key = turnKey();
		// DSH increments turns when a step closes in a turn it has not counted yet.
		const newTurn = key !== lastTurnKey;
		lastTurnKey = key;
		// Sessions are counted per run; the totals fold keeps the rest.
		totals = applySample(totals, sample, newTurn);
		cmd.state.set('samples', samples);
		paint();
	});

	// ── surfaces ────────────────────────────────────────────────────────────────
	// Band above the prompt: the left half of the DSH strip, in the same order.
	cmd.ui.widget({
		placement: 'above-editor',
		render: () => {
			const tps = speed();
			const tail =
				tps !== undefined
					? formatSpeed(tps)
					: samples[samples.length - 1]?.untimed === true
						? '?'
						: undefined;
			const counts = `${totals.turns} turns ${totals.steps} steps`;
			const line: unknown[] = [
				{type: 'text', text: `${GAUGE_GLYPH} ${counts}${tail !== undefined ? ` \u00b7 ${tail} tok/s` : ''}`, dim: true},
			];
			return line as never;
		},
	});

	cmd.ui.pane({
		id: 'session-stats',
		title: 'Session statistics',
		render: () => {
			const last = samples[samples.length - 1];
			const ttft = meanTtft(totals);
			const tps = tpsOf(totals);
			const rows: string[] = [];
			if (totals.llmMs > 0) rows.push(`LLM time                ${formatDuration(totals.llmMs)}`);
			rows.push(`Model calls             ${totals.steps}`);
			if (totals.toolMs > 0) rows.push(`Tool time               ${formatDuration(totals.toolMs)}`);
			if (ttft !== undefined) rows.push(`Avg time to first token ${formatDuration(ttft)}`);
			rows.push(`Tokens per second       ${tps !== undefined ? `${formatSpeed(tps)} tok/s` : '-'}`);
			const aggregate = cacheHitOf(samples);
			const total = aggregate.billed + aggregate.output;
			rows.push(`Tokens                  ${formatCompactTokens(total)} tok`);
			rows.push(`Cache hit               ${aggregate.hit !== undefined ? `${formatCacheHit(aggregate.hit)}%` : '-'}`);
			if (last?.untimed === true) {
				rows.push('_Last request had no per-token timing; excluded from tps._');
			}
			return [
				...rows.map(text => ({type: 'markdown', text})),
				{
					type: 'row',
					children: [
						{type: 'button', label: 'Copy report', key: 'copy', onPress: () => void cmd.ui.copy(report(samples, totals))},
						{type: 'button', label: 'Reset', key: 'reset', onPress: () => reset()},
					],
				},
			];
		},
	});

	// Clears the measurement, not the session: turns already happened and stay counted,
	// so the strip keeps agreeing with what the person did.
	const reset = (): void => {
		const cleared = samples.length;
		const turnsSoFar = totals.turns;
		samples = [];
		totals = {...zeroTotals(), turns: turnsSoFar};
		lastTurnKey = turnKey();
		paint();
		cmd.ui.notify(`session-stats: cleared ${cleared} request(s)`);
	};

	cmd.addCommand({
		name: 'cstats',
		description: 'Session stats: turns, steps, settled tok/s, cache hit, context',
		argumentHint: 'reset | context',
		handler: ({args}: {args?: string}) => {
			const arg = (args ?? '').trim();
			if (arg === 'reset') {
				reset();
				return undefined;
			}
			if (arg === 'context') {
				const usage = (cmd as unknown as {getContextUsage?: () => unknown}).getContextUsage?.();
				return {message: `getContextUsage(): ${JSON.stringify(usage)}`};
			}
			cmd.ui.openPane('session-stats', {focus: true});
			return undefined;
		},
	});
}

function report(samples: readonly RequestSample[], totals: Totals): string {
	const lines: string[] = [];
	lines.push(`turns ${totals.turns} · steps ${totals.steps} · tps ${tpsOf(totals)?.toFixed(1) ?? '-'}`);
	lines.push(`llm ${formatDuration(totals.llmMs)} · ttft ${meanTtft(totals) !== undefined ? formatDuration(meanTtft(totals) as number) : '-'}`);
	lines.push('');
	lines.push('#  model                        effort    tps    out   span     ttft    cache  input/cached/write');
	for (const [index, sample] of samples.slice(-20).entries()) {
		lines.push(
			[
				String(samples.length - Math.min(20, samples.length) + index + 1).padStart(2),
				(sample.model ?? '?').split('/').pop()?.slice(0, 24).padEnd(26) ?? '',
				(sample.effort ?? '-').padStart(6),
				(sample.tps !== undefined ? formatSpeed(sample.tps) : '-').padStart(6),
				String(sample.outputTokens ?? '-').padStart(5),
				(sample.spanMs !== undefined ? formatDuration(sample.spanMs) : '-').padStart(7),
				(sample.ttftMs !== undefined ? formatDuration(sample.ttftMs) : '-').padStart(7),
				(sample.cacheHit !== undefined ? `${formatCacheHit(sample.cacheHit)}%` : '-').padStart(6),
				`${sample.inputTokens}/${sample.cacheReadTokens}/${sample.cacheWriteTokens}`.padStart(18),
			].join(' '),
		);
	}
	return lines.join('\n');
}
