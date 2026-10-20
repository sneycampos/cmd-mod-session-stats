// Rendering for the DSH-parity variant of tps-stats.
//
// Every glyph below is verbatim from DeepSeek Harness 0.2.1-rc.2:
//   gauge  = dsh-client-ui-primitives IconGaugeOutlineRegular   (16px viewBox)
//   db     = IconDatabaseOutlineRegular                        (16px viewBox)
//   ring   = dsh-client-ui-conversation ContextMeter (14px viewBox, r=5.5, 2px stroke)
//   arc    = IconLoadingOutlineRegular, used as the 11%-style indicator path

/** Icon glyphs reprinted as single UTF-8 runes (see index.ts for why). */
export const GAUGE_GLYPH = '\u25d4';
export const DATABASE_GLYPH = '\u1587';

/** The verbatim DSH markup, kept for docs/hosts that can draw SVG. */
export const GAUGE_SVG_MARKUP =
	'<svg viewBox="0 0 16 16" fill="none"><path d="M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096" stroke="currentColor"/><path d="M8 8.49994L11.6114 4.88855" stroke="currentColor"/><circle cx="8" cy="8.5" r="1.25" fill="currentColor"/></svg>';

export const SEP = ' · ';

/** 12m36s / 45.2s — the dsh-client-ui-chat formatDuration. */
export function formatDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
	const whole = Math.round(seconds);
	return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/** 3.2M / 19.8M / 950k — DSH's compact token form. */
export function formatCompactTokens(tokens: number): string {
	if (tokens < 1000) return String(Math.round(tokens));
	if (tokens < 1_000_000) {
		const k = tokens / 1000;
		return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
	}
	return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** Integer, but a near-full hit never prints 100%. */
export function formatCacheHit(percent: number): string {
	if (percent >= 99.95) return '100';
	if (percent >= 10) return String(Math.floor(percent));
	return (percent < 1 ? percent.toFixed(1) : String(Math.floor(percent)));
}

export function formatSpeed(tps: number): string {
	return tps >= 10 ? String(Math.round(tps)) : String(Math.round(tps * 10) / 10);
}
