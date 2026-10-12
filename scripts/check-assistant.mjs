import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkAssistant({ origin, fetchImpl = globalThis.fetch } = {}) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('Provide the application origin.'); }
  if (url.origin !== origin || url.username || url.password ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use an exact HTTPS origin or a local HTTP origin.');
  }
  // This is an application status read, never a provider request or readiness probe.
  const response = await fetchImpl(new URL('/api/agent-status', url), {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Application status returned HTTP ${response.status}.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 16 * 1024) throw new Error('Application status exceeded the size limit.');
  let status;
  try { status = JSON.parse(text); } catch { throw new Error('Application status was not valid JSON.'); }
  const allowed = ['ready', 'busy', 'not_configured', 'paused', 'budget_unavailable', 'budget_exhausted', 'synthetic_mode'];
  if (!status || !allowed.includes(status.providerStatus) || typeof status.configured !== 'boolean' ||
      (status.operatorReviewRequired !== undefined && typeof status.operatorReviewRequired !== 'boolean')) {
    throw new Error('Application status did not identify assistant readiness.');
  }
  return {
    healthy: status.configured && ['ready', 'busy'].includes(status.providerStatus) && !status.operatorReviewRequired,
    providerStatus: status.providerStatus,
    operatorReviewRequired: status.operatorReviewRequired === true,
    ...(Number.isInteger(status.remainingRequests) ? { remainingRequests: status.remainingRequests } : {}),
    ...(Number.isInteger(status.maxRequestsPerDay) ? { maxRequestsPerDay: status.maxRequestsPerDay } : {}),
    liveProviderVerified: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && !(args.length === 2 && args[0] === '--origin')) throw new Error('Use check-assistant.mjs [--origin URL].');
    const result = await checkAssistant({ origin: args[1] || process.env.APP_ORIGIN || 'http://127.0.0.1:4173' });
    console.log(JSON.stringify(result));
    process.exitCode = result.healthy ? 0 : 1;
  } catch {
    console.error('Assistant status check failed. Check the application URL and its status response; no provider request was made.');
    process.exitCode = 1;
  }
}
