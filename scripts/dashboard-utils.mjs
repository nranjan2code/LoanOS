export const DASHBOARD_STATUSES = Object.freeze(['Implemented', 'Partial', 'Partial/Mock', 'Mock', 'Missing', 'Partner', 'External']);
export const DASHBOARD_WEIGHT = Object.freeze({ Implemented: 1, 'Partial/Mock': 0.4, Partial: 0.4, Mock: 0.3, Missing: 0, Partner: null, External: null });

export function rollupCapabilities(features) {
  const counts = Object.fromEntries(DASHBOARD_STATUSES.map((status) => [status, 0]));
  let weighted = 0; let scored = 0;
  for (const feature of features) {
    if (!(feature.status in DASHBOARD_WEIGHT)) throw new Error(`Unsupported dashboard status: ${feature.status}`);
    counts[feature.status] += 1;
    const weight = DASHBOARD_WEIGHT[feature.status];
    if (weight !== null) { weighted += weight; scored += 1; }
  }
  const evidenceCount = features.filter((feature) => Array.isArray(feature.evidence) && feature.evidence.length > 0).length;
  const evidenceQualifiedCount = features.filter((feature) => {
    const metadata = ['owner', 'acceptance', 'notes', 'lastReviewed'].every((field) => typeof feature[field] === 'string' && feature[field].trim());
    const evidence = Array.isArray(feature.evidence) ? feature.evidence : [];
    if (!metadata || evidence.length === 0) return false;
    return feature.status !== 'Implemented' || (evidence.some((item) => item.type === 'test') && evidence.some((item) => item.type === 'code' || item.type === 'endpoint'));
  }).length;
  return {
    counts, total: features.length, scored,
    excluded: features.length - scored,
    maturityPct: scored ? Math.round((weighted / scored) * 100) : 0,
    evidenceCount,
    evidencePct: features.length ? Math.round((evidenceCount / features.length) * 100) : 0,
    evidenceQualifiedCount,
    evidenceQualifiedPct: features.length ? Math.round((evidenceQualifiedCount / features.length) * 100) : 0,
  };
}

export function parseBacklogEpics(markdown) {
  const lines = markdown.split('\n'); const epics = [];
  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(/^##\s+(Epic\s+\d+:.*)/); if (!heading) continue;
    let status = '';
    for (let j = i + 1; j < lines.length && !lines[j].startsWith('## '); j += 1) {
      const match = lines[j].match(/^Status:\s*(.+)/); if (match) { status = match[1].trim(); break; }
    }
    epics.push({ name: heading[1], status });
  }
  return epics;
}

export function parseTapSummary(output) {
  const value = (key) => { const matches = [...output.matchAll(new RegExp(`^[#ℹ]\\s*${key}\\s+(\\d+)\\s*$`, 'gm'))]; return matches.length ? Number(matches.at(-1)[1]) : null; };
  const total = value('tests'); const pass = value('pass'); const fail = value('fail'); const skipped = value('skipped');
  return { pass, fail, skipped, total, ran: total !== null, source: 'live' };
}
