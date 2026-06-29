import { initState, allowRequest } from '../services/rate_limit_wrapper';

const BASE_MS = 1_700_000_000_000;
const config = { maxPerMinute: 60, maxConcurrent: 10 };
const state = initState(config, BASE_MS);
console.log('initial state:', JSON.stringify(state));

const r1 = allowRequest(state, config, BASE_MS);
console.log('first allowRequest:', JSON.stringify({ ...r1, state: '(state ref)' }));
console.log('state after first:', JSON.stringify(state));

for (let i = 0; i < 59; i++) {
  const r = allowRequest(state, config, BASE_MS);
  if (!r.allowed) {
    console.log('FAIL at iteration', i, 'state:', JSON.stringify(state));
    process.exit(1);
  }
}
console.log('All 60 passed, tokens remaining:', state.tokens);
