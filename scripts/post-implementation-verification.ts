import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/database';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001/api';
const ADMIN_TEST_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

type CookieJar = Map<string, string>;

const addCookiesFromResponse = (response: Response, jar: CookieJar): void => {
  const anyHeaders = response.headers as unknown as { getSetCookie?: () => string[] };
  const setCookies = anyHeaders.getSetCookie?.() || [];
  for (const header of setCookies) {
    const firstPart = header.split(';')[0];
    const eqIndex = firstPart.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = firstPart.slice(0, eqIndex).trim();
    const value = firstPart.slice(eqIndex + 1).trim();
    jar.set(name, value);
  }
};

const cookieHeader = (jar: CookieJar): string =>
  Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

const jsonFetch = async <T>(
  url: string,
  options?: RequestInit,
  jar?: CookieJar
): Promise<{ response: Response; json: T }> => {
  const headers = new Headers(options?.headers || {});
  if (jar && jar.size > 0) {
    headers.set('Cookie', cookieHeader(jar));
  }
  const response = await fetch(url, { ...options, headers });
  if (jar) {
    addCookiesFromResponse(response, jar);
  }
  const json = (await response.json()) as T;
  return { response, json };
};

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

const testA = async (): Promise<void> => {
  section('Test A: Public Survey Structure');
  const { response, json } = await jsonFetch<{
    assessment: { id: string; title: string };
    dimensions: Array<{
      title: string;
      topics: Array<{ id: string; label: string; levelAnchors: Array<string | null> | null }>;
    }>;
  }>(`${API_BASE}/public/assessments/active/structure`);

  if (!response.ok) {
    console.log(`FAILED: HTTP ${response.status}`);
    console.log(json);
    return;
  }

  const topics = json.dimensions.flatMap((d) =>
    d.topics.map((t) => ({ dimension: d.title, ...t }))
  );

  console.log(`Assessment: ${json.assessment.title}`);
  console.log(`Total topics: ${topics.length}`);
  console.log('First 2 topics with levelAnchors:');
  topics.slice(0, 2).forEach((topic, idx) => {
    console.log(
      `${idx + 1}. [${topic.dimension}] ${topic.label} -> ${JSON.stringify(topic.levelAnchors)}`
    );
  });

  const invalid = topics.filter(
    (t) =>
      !Array.isArray(t.levelAnchors) ||
      t.levelAnchors.length !== 5 ||
      t.levelAnchors.every((x) => x == null || String(x).trim() === '')
  );

  if (invalid.length === 0) {
    console.log('PASS: Every topic has levelAnchors with 5 items and not all-empty values.');
  } else {
    console.log(`FLAGGED TOPICS (${invalid.length}):`);
    invalid.forEach((t) => console.log(`- ${t.label} (${t.id}) levelAnchors=${JSON.stringify(t.levelAnchors)}`));
  }
};

const loginAdminWithCsrf = async (): Promise<{ jar: CookieJar; csrfToken: string }> => {
  if (!ADMIN_TEST_PASSWORD || ADMIN_TEST_PASSWORD.length < 12) {
    throw new Error('[VERIFY] SEED_ADMIN_PASSWORD env var is required and must be >=12 chars');
  }

  const jar: CookieJar = new Map();
  const csrf = await jsonFetch<{ csrfToken: string }>(`${API_BASE}/csrf-token`, { method: 'GET' }, jar);
  const csrfToken = csrf.json.csrfToken;

  const login = await jsonFetch<{ success: boolean; error?: string }>(
    `${API_BASE}/admin/auth/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@leadership.com', password: ADMIN_TEST_PASSWORD }),
    },
    jar
  );

  if (!login.response.ok || !login.json.success) {
    throw new Error(`Admin login failed: ${JSON.stringify(login.json)}`);
  }

  return { jar, csrfToken };
};

const testB = async (): Promise<{ testedTopicIds: string[] }> => {
  section('Test B: Topic Recommendations Test Endpoint');
  const topicResult = await pool.query('SELECT id, label FROM topics ORDER BY label LIMIT 3');
  const topics = topicResult.rows as Array<{ id: string; label: string }>;
  const { jar, csrfToken } = await loginAdminWithCsrf();

  for (const topic of topics) {
    const { response, json } = await jsonFetch<{
      matchedRecommendations?: Array<{ title: string; priority: number }>;
      error?: string;
    }>(
      `${API_BASE}/admin/topics/${topic.id}/recommendations/test`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ score: 2.0, target: 4.0 }),
      },
      jar
    );

    if (!response.ok) {
      console.log(`- ${topic.label}: FAILED HTTP ${response.status} -> ${JSON.stringify(json)}`);
      continue;
    }

    const matched = json.matchedRecommendations || [];
    if (matched.length === 0) {
      console.log(`- ${topic.label}: none`);
    } else {
      console.log(`- ${topic.label}:`);
      matched.forEach((r) => console.log(`  * ${r.title} (priority ${r.priority})`));
    }
  }

  return { testedTopicIds: topics.map((t) => t.id) };
};

const testC = async (): Promise<void> => {
  section('Test C: Results with Recommendations');
  const responseRow = await pool.query(
    `SELECT id, session_token
     FROM assessment_responses
     WHERE status = 'completed'
       AND session_token IS NOT NULL
     ORDER BY completed_at DESC NULLS LAST, started_at DESC
     LIMIT 1`
  );

  if (responseRow.rows.length === 0) {
    console.log('No completed responses exist yet.');
    return;
  }

  const responseId = responseRow.rows[0].id as string;
  const sessionToken = responseRow.rows[0].session_token as string;
  const { response, json } = await jsonFetch<{
    success: boolean;
    data?: {
      dimensions: Array<{ title: string; recommendations: unknown[] }>;
      topRecommendations: unknown[];
    };
  }>(`${API_BASE}/public/responses/${responseId}/results`, {
    headers: {
      'x-session-token': sessionToken,
    },
  });

  if (!response.ok || !json.success || !json.data) {
    console.log(`FAILED: HTTP ${response.status} -> ${JSON.stringify(json)}`);
    return;
  }

  const firstDimension = json.data.dimensions[0];
  console.log(`Response ID: ${responseId}`);
  console.log('dimensions[0].recommendations:');
  console.log(JSON.stringify(firstDimension?.recommendations || [], null, 2));
  console.log('topRecommendations (top 3):');
  console.log(JSON.stringify((json.data.topRecommendations || []).slice(0, 3), null, 2));
};

const printCodeSection = (
  filePath: string,
  startPattern: RegExp,
  endPattern?: RegExp
): string => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  if (startIndex === -1) return `Pattern not found in ${filePath}`;

  let endIndex = lines.length - 1;
  if (endPattern) {
    const relative = lines.slice(startIndex + 1).findIndex((line) => endPattern.test(line));
    if (relative >= 0) {
      endIndex = startIndex + relative;
    }
  }

  return lines.slice(startIndex, endIndex + 1).join('\n');
};

const testD = (): void => {
  section('Test D: Slider Code Verification');
  const repoRoot = path.resolve(__dirname, '..', '..');
  const dualSlider = path.join(repoRoot, 'HORVÁTH', 'src', 'components', 'ui', 'sliders', 'DualSlider.tsx');
  const readinessStore = path.join(repoRoot, 'HORVÁTH', 'src', 'store', 'readiness', 'readiness.store.ts');
  const topicCard = path.join(repoRoot, 'HORVÁTH', 'src', 'components', 'survey', 'TopicCard.tsx');

  console.log('\nDualSlider.tsx (valid values array + step default):');
  console.log(printCodeSection(dualSlider, /const VALID_SCORES =/, /;\s*$/));
  console.log(printCodeSection(dualSlider, /step = 0\.5/));

  console.log('\nreadiness.store.ts (submitAnswer function):');
  console.log(printCodeSection(readinessStore, /submitAnswer: async/, /completeAssessment: async/));

  console.log('\nTopicCard.tsx (step prop):');
  console.log(printCodeSection(topicCard, /step=\{0\.5\}/));
};

const diagnoseCoverage = async (): Promise<{ previouslyEmptyTopic: { id: string; label: string } | null }> => {
  section('Issue 2 - Step 1: Diagnose Recommendation Coverage');
  const recFile = path.resolve(__dirname, '..', 'recommendations.json');
  const recJson = JSON.parse(fs.readFileSync(recFile, 'utf-8')) as {
    rules: Array<{ topicId: string }>;
  };

  const rulesCount = recJson.rules.length;
  const topicKeys = new Set(
    (await pool.query('SELECT topic_key FROM topics')).rows.map((r) => r.topic_key as string)
  );

  const mapped = recJson.rules.filter((r) => topicKeys.has(r.topicId));
  const failed = recJson.rules
    .map((r) => r.topicId)
    .filter((key) => !topicKeys.has(key));

  const mappedTopicRows = await pool.query(
    `SELECT DISTINCT t.topic_key, t.label
     FROM topics t
     JOIN topic_recommendations tr ON tr.topic_id = t.id
     WHERE tr.is_active = true
     ORDER BY t.topic_key`
  );

  const emptyTopicRows = await pool.query(
    `SELECT t.id, t.label
     FROM topics t
     WHERE NOT EXISTS (
       SELECT 1
       FROM topic_recommendations tr
       WHERE tr.topic_id = t.id AND tr.is_active = true
     )
     ORDER BY t.label`
  );

  const previouslyEmptyTopic =
    emptyTopicRows.rows.length > 0
      ? ({ id: emptyTopicRows.rows[0].id as string, label: emptyTopicRows.rows[0].label as string } as const)
      : null;

  console.log(`Rules in recommendations.json: ${rulesCount}`);
  console.log(`Mapped successfully to existing topics: ${mapped.length}`);
  console.log(`Failed mappings: ${failed.length}`);
  if (failed.length > 0) {
    failed.forEach((key) => console.log(`- ${key}`));
  }

  console.log(`Topics currently with recommendations (${mappedTopicRows.rows.length}):`);
  mappedTopicRows.rows.forEach((row) => console.log(`- ${row.topic_key} (${row.label})`));

  console.log(`Topics currently with 0 active recommendations: ${emptyTopicRows.rows.length}`);
  if (previouslyEmptyTopic) {
    console.log(
      `Using previously-empty topic for retest after fix: ${previouslyEmptyTopic.label} (${previouslyEmptyTopic.id})`
    );
  }

  return { previouslyEmptyTopic };
};

const seedBaselineRecommendations = async (): Promise<void> => {
  section('Issue 2 - Step 2: Seed Missing Recommendations');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE tmp_topics_without_recs AS
      SELECT t.id, t.label
      FROM topics t
      WHERE NOT EXISTS (
        SELECT 1 FROM topic_recommendations tr
        WHERE tr.topic_id = t.id AND tr.is_active = true
      );
    `);

    await client.query(`
      INSERT INTO topic_recommendations (
        topic_id, score_max, gap_min,
        title, description,
        why, what, how,
        action_items, category, priority, tags,
        is_active, order_index
      )
      SELECT
        t.id,
        2.5,
        0.5,
        'Build foundational ' || t.label || ' practices',
        'Current maturity is low. Focus on establishing basic processes and awareness.',
        'Without foundational practices, improvements in this area will be unsustainable.',
        'Establish basic processes, roles, and guidelines for ' || t.label,
        '1. Assess current state in detail
2. Identify quick wins
3. Assign ownership
4. Document basic procedures',
        '["Conduct gap assessment","Assign topic owner","Create basic documentation","Schedule monthly review"]'::jsonb,
        'Quick Win',
        70,
        ARRAY['foundation', 'quick-win'],
        true,
        0
      FROM tmp_topics_without_recs t;
    `);

    await client.query(`
      INSERT INTO topic_recommendations (
        topic_id, score_min, score_max, gap_min,
        title, description,
        why, what, how,
        action_items, category, priority, tags,
        is_active, order_index
      )
      SELECT
        t.id,
        2.0,
        3.5,
        1.5,
        'Advance ' || t.label || ' capability',
        'You have foundations but significant gap remains. A structured project approach needed.',
        'Closing this gap will create measurable competitive improvement.',
        'Develop structured programs to systematically improve ' || t.label,
        '1. Define target state clearly
2. Build capability roadmap
3. Allocate resources
4. Track progress quarterly',
        '["Define success metrics","Build 90-day roadmap","Assign project team","Establish review cadence"]'::jsonb,
        'Project',
        60,
        ARRAY['capability', 'structured'],
        true,
        1
      FROM tmp_topics_without_recs t;
    `);

    await client.query(`
      INSERT INTO topic_recommendations (
        topic_id, target_min, gap_min,
        title, description,
        why, what, how,
        action_items, category, priority, tags,
        is_active, order_index
      )
      SELECT
        t.id,
        4.0,
        2.0,
        'Transform ' || t.label || ' to industry leadership',
        'Your ambition is high and the gap is significant. This requires strategic investment.',
        'Industry leadership in this area will create lasting competitive advantage.',
        'Make ' || t.label || ' a strategic priority with dedicated resources and executive sponsorship',
        '1. Secure executive sponsorship
2. Allocate dedicated budget
3. Build or hire specialized capability
4. Set industry benchmark targets',
        '["Present business case to leadership","Benchmark against industry leaders","Build transformation roadmap","Establish innovation team"]'::jsonb,
        'Big Bet',
        50,
        ARRAY['transformation', 'strategic'],
        true,
        2
      FROM tmp_topics_without_recs t;
    `);

    const count = await client.query('SELECT COUNT(*)::int AS count FROM topic_recommendations');
    await client.query('COMMIT');
    console.log(`New total topic_recommendations count: ${count.rows[0].count}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const retestTopic = async (topic: { id: string; label: string } | null): Promise<void> => {
  section('Issue 2 - Retest on Previously Empty Topic');
  if (!topic) {
    console.log('No previously-empty topic found, skipping retest.');
    return;
  }

  const { jar, csrfToken } = await loginAdminWithCsrf();
  const { response, json } = await jsonFetch<{ matchedRecommendations: Array<{ title: string; priority: number }> }>(
    `${API_BASE}/admin/topics/${topic.id}/recommendations/test`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({ score: 2.0, target: 4.0 }),
    },
    jar
  );

  if (!response.ok) {
    console.log(`FAILED: HTTP ${response.status}`);
    console.log(json);
    return;
  }

  console.log(`Topic: ${topic.label}`);
  if (!json.matchedRecommendations || json.matchedRecommendations.length === 0) {
    console.log('Result: none');
    return;
  }

  console.log('Triggered recommendations:');
  json.matchedRecommendations.forEach((r) =>
    console.log(`- ${r.title} (priority ${r.priority})`)
  );
};

const main = async (): Promise<void> => {
  try {
    await waitForServer();
    await testA();
    await testB();
    await testC();
    testD();
    const { previouslyEmptyTopic } = await diagnoseCoverage();
    await seedBaselineRecommendations();
    await retestTopic(previouslyEmptyTopic);
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Verification script failed:', error);
  process.exit(1);
});
