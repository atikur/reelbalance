import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAssistant } from './check-assistant.mjs';

test('assistant monitor reads only the application status and accepts a busy healthy assistant', async () => {
  let calls = 0;
  const result = await checkAssistant({ origin: 'https://reelbalance.example', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.href, 'https://reelbalance.example/api/agent-status');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ configured: true, providerStatus: 'busy', remainingRequests: 119, maxRequestsPerDay: 120 }));
  } });
  assert.equal(calls, 1);
  assert.equal(result.healthy, true);
  assert.equal(result.liveProviderVerified, false);
});

test('cached HTTP success does not hide paused, exhausted or synthetic assistant access', async () => {
  for (const providerStatus of ['paused', 'budget_exhausted', 'budget_unavailable', 'not_configured', 'synthetic_mode']) {
    const result = await checkAssistant({ origin: 'http://127.0.0.1:4173', fetchImpl: async () =>
      new Response(JSON.stringify({ configured: !['not_configured', 'synthetic_mode'].includes(providerStatus), providerStatus })) });
    assert.equal(result.healthy, false);
  }
});

test('an unfinished durable lock is unhealthy while an active interaction can remain healthy', async () => {
  for (const operatorReviewRequired of [false, true]) {
    const result = await checkAssistant({ origin: 'https://reelbalance.example', fetchImpl: async () =>
      new Response(JSON.stringify({ configured: true, providerStatus: 'busy', operatorReviewRequired })) });
    assert.equal(result.healthy, !operatorReviewRequired);
    assert.equal(result.operatorReviewRequired, operatorReviewRequired);
  }
});

test('assistant monitor rejects credential-bearing origins and unreadable status without following redirects', async () => {
  let calls = 0;
  for (const origin of ['https://user:password@reelbalance.example', 'https://reelbalance.example/path', 'http://remote.example']) {
    await assert.rejects(checkAssistant({ origin, fetchImpl: async () => { calls++; } }));
  }
  assert.equal(calls, 0);
  await assert.rejects(checkAssistant({ origin: 'https://reelbalance.example', fetchImpl: async () => new Response('{}') }), /readiness/);
  await assert.rejects(checkAssistant({ origin: 'https://reelbalance.example', fetchImpl: async () => new Response('{}', { status: 503 }) }), /HTTP 503/);
});
