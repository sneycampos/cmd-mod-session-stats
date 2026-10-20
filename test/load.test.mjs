// Loads the mod against a fake ModApi and checks the strip it renders.
// No dependencies, no build step: the same Node that runs the tests strips the types.
//
//   node --experimental-strip-types test/load.test.mjs

import assert from 'node:assert/strict';
import {register} from 'node:module';

// The published harness package ships types only; at runtime the import is erased,
// but Node still has to resolve a specifier that may be read as a type import.
register(
	'data:text/javascript,' +
		encodeURIComponent(
			'export async function resolve(s, c, n) { if (s === "@commandcode/harness") return {url: "data:text/javascript,export {}", shortCircuit: true}; return n(s, c); }',
		),
);

const {default: factory} = await import('../src/index.ts');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const handlers = new Map();
const commands = {};
const widgets = [];
const panes = {};
const flags = {};
let status;
const cmd = {
	ui: {
		setStatus: text => {
			status = text;
		},
		widget: widget => (widgets.push(widget), {dispose() {}}),
		pane: pane => ((panes[pane.id] = pane), {dispose() {}}),
		refreshWidgets() {},
		openPane() {},
		notify() {},
		copy: async () => ({ok: true}),
	},
	on: (event, fn) => (handlers.set(event, fn), {dispose() {}}),
	addCommand: command => ((commands[command.name] = command), {dispose() {}}),
	addFlag: (name, spec) => ((flags[name] = spec), {dispose() {}}),
	getFlag: name => flags[name]?.default,
	state: {
		values: new Map(),
		get(key) {
			return this.values.get(key);
		},
		set(key, value) {
			this.values.set(key, value);
		},
	},
	getContextUsage: () => ({tokens: 23100, contextWindow: 200000, percent: 11}),
};

factory(cmd);

const fire = (type, data = {}) => handlers.get(type)?.({...data, type});

assert.deepEqual(Object.keys(commands), ['cstats'], 'exports exactly one /cstats command');
assert.ok(flags['sessionStatsSpeed'], 'registers the prefixed speed flag');
assert.equal(status, undefined, 'paints nothing before the first settled request');

fire('run_start', {});
fire('model_request_start', {model: 'deepseek/deepseek-v4.1-flash'});
await sleep(40);
fire('thinking_delta', {delta: 'Plan'});
await sleep(200);
fire('text_delta', {delta: 'Red'});
await sleep(120);
fire('text_delta', {delta: ' green'});
await sleep(120);
fire('text_delta', {delta: ' blue'});
await sleep(60);
fire('model_request_end', {
	model: 'deepseek/deepseek-v4.1-flash',
	effort: 'high',
	usage: {inputTokens: 16549, outputTokens: 30, cacheReadTokens: 6912, cacheWriteTokens: 0},
});

// The band carries the DSH counts string and a settled rate.
const band = widgets[0].render({width: 100}).map(node => node.text).join('\n');
const counts = /^(\S+) (\d+) turns (\d+) steps · (\d+(?:\.\d+)?) tok\/s$/.exec(band);
assert.ok(counts, `band matches "{turns} turns {steps} steps · {tps} tok/s": ${band}`);
assert.equal(counts[2], '1');
assert.equal(counts[3], '1');
assert.ok(Number(counts[4]) > 0, 'settled tps is positive');

// The status segment carries the DSH usage strings: billed tokens, cache hit, context.
const usage = /^(\S+) ([\d.]+[kM]?) tok · Cache hit (\d+(?:\.\d+)?)% · (\d+)%$/.exec(status);
assert.ok(usage, `status matches "{total} tok · Cache hit {percent}% · {percent}%": ${status}`);
assert.equal(usage[3], '29', 'cache hit = read / (uncached + read + write)');
assert.equal(usage[4], '11');

// The pane mirrors the DSH "Session statistics" dialog rows.
const rows = panes['session-stats'].render().filter(node => node.type === 'markdown').map(node => node.text);
for (const row of ['Model calls', 'Avg time to first token', 'Tokens per second', 'Cache hit']) {
	assert.ok(rows.some(text => text.startsWith(row)), `pane has a "${row}" row`);
}

assert.deepEqual(JSON.parse(commands['cstats'].handler({args: 'context'}).message.slice('getContextUsage(): '.length)), {
	tokens: 23100,
	contextWindow: 200000,
	percent: 11,
});

// A burst request (answer text in one late flush, no reasoning) is untimed, not guessed.
fire('model_request_start', {model: 'xiaomi/mimo-v2.6-pro'});
await sleep(400);
fire('text_delta', {delta: 'one flush'});
fire('model_request_end', {
	model: 'xiaomi/mimo-v2.6-pro',
	usage: {inputTokens: 500, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0},
});
const afterBurst = widgets[0].render({width: 100}).map(node => node.text).join('\n');
assert.match(afterBurst, /· \? tok\/s$/, `an untimed request shows "? tok/s": ${afterBurst}`);
// A reporting route with no cache reads is 0%, not a missing segment.
assert.match(status, /Cache hit 0(\.0)?%/, `0% cache is shown, not omitted: ${status}`);

commands['cstats'].handler({args: 'reset'});
// Reset drops the request samples (steps) but not the run count: a turn already
// happened, and losing it would make the strip disagree with the session.
const afterReset = widgets[0].render({width: 100}).map(node => node.text).join('\n');
assert.match(afterReset, /^◔ 1 turns 0 steps$/, `reset clears steps, keeps turns: ${afterReset}`);

console.log('ok — strip, pane and untimed handling verified');
