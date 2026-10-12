import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

const PACKET_KEYS = ['schemaVersion', 'mode', 'datasetId', 'datasetSha256', 'qlooRequests', 'llmRequests', 'scenarios'];
const RESPONSE_KEYS = ['model', 'answer', 'proposal', 'proposalKind', 'startingBriefAssessment', 'startingBriefAssessmentSource', 'toolTrace', 'source', 'usage', 'recordedUsage', 'llmRequests', 'qlooRequests'];
const PROVENANCE_KEYS = ['source', 'sourceSha256', 'recordedAt', 'recordingFinishedAt', 'model', 'reasoningEffort', 'maxOutputTokensPerResponse', 'recordedUsage', 'answerSha256', 'assessmentSource'];
const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

export class DemoRecordingError extends Error {
  constructor() {
    super('The recorded demonstration is unavailable or does not match the current catalogue. Use the local planning tools instead.');
    this.name = 'DemoRecordingError';
    this.status = 503;
    this.code = 'recorded_demo_unavailable';
  }
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
}

export async function loadRecordedDemo(path = new URL('./data/recorded-demo.json', import.meta.url)) {
  const bytes = await readFile(path);
  if (bytes.length > 64 * 1024) throw new DemoRecordingError();
  return JSON.parse(bytes.toString('utf8'));
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validUsage(value) {
  return exactKeys(value, ['inputTokens', 'outputTokens', 'llmRequests', 'qlooRequests']) &&
    Number.isInteger(value.inputTokens) && value.inputTokens > 0 && value.inputTokens < 1_000_000 &&
    Number.isInteger(value.outputTokens) && value.outputTokens > 0 && value.outputTokens <= 6_144 &&
    value.llmRequests === 3 && value.qlooRequests === 0;
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validTrace(trace, dataset, proposal) {
  if (!Array.isArray(trace) || trace.length !== 2) return false;
  return isDeepStrictEqual(trace, [
    { tool: 'read_programme_context', status: 'complete', filmCount: dataset.films.length, profileCount: dataset.profiles.length, qlooRequests: 0 },
    { tool: 'propose_programme', status: 'complete', programmeStatus: proposal.result.status,
      supportedProfiles: proposal.result.represented, runtimeAlternative: proposal.runtimeAlternative?.maximumRuntime ?? null,
      requiresApproval: true, qlooRequests: 0 },
  ]);
}

// A recording never gains authority over current constraints: every stored tool
// result must still exactly match the deterministic service and cached catalogue.
export function createDemoService({ programmeService, recording }) {
  try {
    const dataset = programmeService.bootstrap();
    if (!exactKeys(recording, PACKET_KEYS) || recording.schemaVersion !== 1 || recording.mode !== 'recorded' ||
        recording.datasetId !== dataset.dataset.id || recording.datasetSha256 !== sha256(dataset) ||
        recording.qlooRequests !== 0 || recording.llmRequests !== 0 ||
        !Array.isArray(recording.scenarios) || recording.scenarios.length !== 2 ||
        Buffer.byteLength(JSON.stringify(recording), 'utf8') > 64 * 1024) throw new DemoRecordingError();

    const initial = { slots: 3, maximumRuntime: 110, excluded: [], locked: [], current: [] };
    const order = programmeService.programme(initial).nightOrder;
    if (!Array.isArray(order) || order.length !== 3) throw new DemoRecordingError();
    const contexts = [initial, { slots: 3, maximumRuntime: 110, excluded: [order[2]], locked: order.slice(0, 2), current: [...order] }];
    for (const [index, scenario] of recording.scenarios.entries()) {
      if (!exactKeys(scenario, ['id', 'context', 'message', 'response', 'provenance']) ||
          scenario.id !== ['initial', 'cancellation'][index] || !isDeepStrictEqual(scenario.context, contexts[index]) ||
          typeof scenario.message !== 'string' || !scenario.message.trim() || scenario.message.length > 2_000) throw new DemoRecordingError();
      const response = scenario.response;
      const provenance = scenario.provenance;
      if (!exactKeys(response, RESPONSE_KEYS) || !exactKeys(provenance, PROVENANCE_KEYS) ||
          response.model !== 'gpt-6-luna' || response.source !== 'recorded' || response.proposalKind !== 'same_brief' ||
          response.llmRequests !== 0 || response.qlooRequests !== 0 || !isDeepStrictEqual(response.usage, ZERO_USAGE) ||
          !validUsage(response.recordedUsage) || !isDeepStrictEqual(response.recordedUsage, provenance.recordedUsage) ||
          typeof response.answer !== 'string' || !response.answer.trim() || Buffer.byteLength(response.answer, 'utf8') > 16 * 1024 ||
          provenance.answerSha256 !== sha256(response.answer) || provenance.source !== 'reports/reelbalance-benchmark-raw.json' ||
          !/^[a-f0-9]{64}$/.test(provenance.sourceSha256) || !validTime(provenance.recordedAt) || !validTime(provenance.recordingFinishedAt) ||
          Date.parse(provenance.recordingFinishedAt) < Date.parse(provenance.recordedAt) || provenance.model !== response.model ||
          provenance.reasoningEffort !== 'medium' || provenance.maxOutputTokensPerResponse !== 2048 ||
          provenance.assessmentSource !== 'local_revalidation' || response.startingBriefAssessmentSource !== 'local_revalidation') throw new DemoRecordingError();

      const fresh = programmeService.repairOptions(scenario.context);
      if (!isDeepStrictEqual(response.proposal, { request: scenario.context, ...fresh }) ||
          !isDeepStrictEqual(response.startingBriefAssessment, { request: scenario.context, result: programmeService.programme(scenario.context) }) ||
          !validTrace(response.toolTrace, dataset, response.proposal)) throw new DemoRecordingError();
    }
    const safePacket = structuredClone(recording);
    return { scenarios: () => structuredClone(safePacket) };
  } catch { throw new DemoRecordingError(); }
}
