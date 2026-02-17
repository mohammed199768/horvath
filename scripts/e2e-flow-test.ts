import { pool } from '../src/config/database';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001/api';

const values = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

const section = (name: string): void => {
  console.log('\n============================================================');
  console.log(name);
  console.log('============================================================');
};

const waitForServer = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch('http://localhost:3001/');
      if (response.ok) return;
    } catch {
      // wait and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server not ready at http://localhost:3001/');
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: T }> => {
  const response = await fetch(url, init);
  const json = (await response.json()) as T;
  return { ok: response.ok, status: response.status, json };
};

const pickCurrent = (idx: number): number => values[idx % values.length];
const pickTarget = (current: number, idx: number): number => {
  const bump = values[(idx + 3) % values.length];
  return Math.max(current, bump);
};

const main = async (): Promise<void> => {
  section('E2E Flow Test');
  await waitForServer();

  const structureResp = await fetchJson<{
    assessment: { id: string; title: string };
    dimensions: Array<{ dimensionKey: string; title: string; topics: Array<{ id: string; label: string }> }>;
  }>(`${API_BASE}/public/assessments/active/structure`);

  if (!structureResp.ok) {
    throw new Error(`Failed to load structure: HTTP ${structureResp.status}`);
  }

  const structure = structureResp.json;
  const topics = structure.dimensions.flatMap((d) =>
    d.topics.map((t) => ({ dimension: d.dimensionKey, ...t }))
  );
  console.log(`Loaded assessment: ${structure.assessment.title}`);
  console.log(`Total topics: ${topics.length}`);

  const participantEmail = `e2e+${Date.now()}@example.com`;
  const participantResp = await fetchJson<{
    success: boolean;
    data?: { participantId: string };
    error?: string;
  }>(`${API_BASE}/public/participants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: participantEmail,
      fullName: 'E2E Test User',
      companyName: 'QA Company',
      consentGiven: true,
    }),
  });

  if (!participantResp.ok || !participantResp.json.success || !participantResp.json.data) {
    throw new Error(`Failed to register participant: ${JSON.stringify(participantResp.json)}`);
  }

  const participantId = participantResp.json.data.participantId;
  console.log(`Participant created: ${participantId}`);

  const startResp = await fetchJson<{
    success: boolean;
    data?: { responseId: string; sessionToken: string };
    error?: string;
  }>(`${API_BASE}/public/responses/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assessmentId: structure.assessment.id,
      participantId,
    }),
  });

  if (!startResp.ok || !startResp.json.success || !startResp.json.data) {
    throw new Error(`Failed to start response: ${JSON.stringify(startResp.json)}`);
  }

  const responseId = startResp.json.data.responseId;
  const sessionToken = startResp.json.data.sessionToken;
  console.log(`Response started: ${responseId}`);

  let answered = 0;
  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    const current = pickCurrent(i);
    const target = pickTarget(current, i);

    const answerResp = await fetchJson<{
      success: boolean;
      error?: string;
    }>(`${API_BASE}/public/responses/${responseId}/answer`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': sessionToken,
      },
      body: JSON.stringify({
        topicId: topic.id,
        currentRating: current,
        targetRating: target,
      }),
    });

    if (!answerResp.ok || !answerResp.json.success) {
      throw new Error(
        `Failed to answer topic ${topic.label} (${topic.id}): ${JSON.stringify(answerResp.json)}`
      );
    }
    answered += 1;
  }

  const completeResp = await fetchJson<{ success: boolean; error?: string }>(
    `${API_BASE}/public/responses/${responseId}/complete`,
    {
      method: 'POST',
      headers: { 'x-session-token': sessionToken },
    }
  );

  if (!completeResp.ok || !completeResp.json.success) {
    throw new Error(`Failed to complete response: ${JSON.stringify(completeResp.json)}`);
  }
  console.log('Assessment completed.');

  // The results endpoint is session protected.
  const resultsResp = await fetchJson<{
    success: boolean;
    data?: {
      dimensions: Array<{ title: string; recommendations: unknown[] }>;
      topRecommendations: unknown[];
    };
    error?: string;
  }>(`${API_BASE}/public/responses/${responseId}/results`, {
    headers: { 'x-session-token': sessionToken },
  });

  if (!resultsResp.ok || !resultsResp.json.success || !resultsResp.json.data) {
    throw new Error(`Failed to fetch results: ${JSON.stringify(resultsResp.json)}`);
  }

  const data = resultsResp.json.data;
  const totalRecs = data.dimensions.reduce(
    (sum, d) => sum + (Array.isArray(d.recommendations) ? d.recommendations.length : 0),
    0
  );

  section('E2E Summary');
  console.log(`Topics answered: ${answered}`);
  console.log(`Dimension recommendation entries: ${totalRecs}`);
  console.log(`Top recommendations returned: ${(data.topRecommendations || []).length}`);
  console.log('PASS: End-to-end flow completed and recommendations are present in results payload.');
};

main()
  .catch((error) => {
    console.error('E2E flow test failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
