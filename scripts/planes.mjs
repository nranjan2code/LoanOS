// Category-number -> product plane mapping, and plane display order.
// Mapped from the plane definitions in docs/product/what-we-are-building.md.
// Shared by build-dashboard.mjs and sync-capability-trace.mjs so they never drift.
export const PLANE = {
  1: 'Platform & Tenancy',
  2: 'Compliance OS', 3: 'Compliance OS', 6: 'Compliance OS', 24: 'Compliance OS', 28: 'Compliance OS',
  4: 'LOS', 5: 'LOS', 7: 'LOS', 9: 'LOS', 10: 'LOS', 11: 'LOS', 12: 'LOS', 13: 'LOS',
  14: 'LMS', 15: 'LMS', 16: 'LMS', 17: 'LMS', 18: 'LMS', 19: 'LMS', 20: 'LMS',
  8: 'LWS', 21: 'LWS', 22: 'LWS', 23: 'LWS',
  25: 'Finance & Treasury', 26: 'Risk & Portfolio', 27: 'AI & Model Governance',
  29: 'Security & IAM', 30: 'Data & Integration', 31: 'Reliability & Ops',
  32: 'Experience & Adoption', 33: 'Experience & Adoption',
};

export const PLANE_ORDER = ['LOS', 'LMS', 'LWS', 'Compliance OS', 'Platform & Tenancy', 'AI & Model Governance', 'Risk & Portfolio', 'Finance & Treasury', 'Security & IAM', 'Data & Integration', 'Reliability & Ops', 'Experience & Adoption'];

// Parse the Detailed Capability Register from the capability catalogue markdown.
// Returns [{ n, name, plane, features:[{id,name,applicability,rawStatus}] }].
export function parseRegister(md) {
  const start = md.indexOf('## Detailed Capability Register');
  const end = md.indexOf('## Product-Specific Capability Packs');
  const lines = md.slice(start, end > 0 ? end : undefined).split('\n');
  const categories = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^###\s+(\d+)\.\s+(.+)/);
    if (h) { cur = { n: Number(h[1]), name: h[2].trim(), plane: PLANE[Number(h[1])] || 'Other', features: [] }; categories.push(cur); continue; }
    const m = line.match(/^\|\s*([A-Z]{2,3}-\d{3})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (m && cur) cur.features.push({ id: m[1], name: m[2], applicability: m[3], rawStatus: m[4] });
  }
  return categories;
}

export function normalizeStatus(raw) {
  const s = raw.toLowerCase();
  if (s.includes('mock') && s.includes('partial')) return 'Partial/Mock';
  if (s.startsWith('mostly missing') || s === 'missing' || s.startsWith('missing')) return 'Missing';
  if (s.startsWith('implemented')) return 'Implemented';
  if (s.startsWith('partial')) return 'Partial';
  if (s.startsWith('partner') || s.includes('/partner')) return 'Partner';
  if (s.startsWith('external')) return 'External';
  if (s.startsWith('mock')) return 'Mock';
  return 'Partial';
}
