import { FEATURE_STAFFING_POLICIES, authorizeStaffedFeatureAction } from "../../../packages/core/src/saas-identity-governance.js";
import { decidePlatformControlStaffing } from "./control-rules-engine.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SELF_GOVERNED_PREFIXES = ["/activity/screen-events", "/admin/identity-governance/"];

// Every staffing family has at least one deterministic route classifier. In
// active mode an unclassified staff mutation is denied, so new endpoints must
// deliberately select a control family instead of silently bypassing staffing.
export const MUTATION_STAFFING_ROUTE_RULES = Object.freeze([
  rule("FST-001", /^\/(admin\/(users|invites|access-reviews|federation|scim|identity-operations|sessions|service-credentials|service-credential-compromises|api-key)|identity-operations-worker\/v1)/),
  rule("FST-002", /^\/(products|product-configurations|journeys|pricing-policies|loans\/marketplace-offers)/),
  rule("FST-003", /^\/(loans\/(applications|decisions|sanctions|eligibility)|channels\/leads)/),
  rule("FST-004", /^\/(borrowers(?:\/|$)|kyc|ckyc|aml\/customer|reporting\/ckycrr)/),
  rule("FST-005", /^\/(decisions\/[^/]+\/(override|human-review)|loans\/applications\/[^/]+\/override)/),
  rule("FST-006", /^\/(disbursements|loans\/applications\/[^/]+\/(document-packet|esign|disbursement)|loan-accounts\/[^/]+\/disburse)/),
  rule("FST-007", /^\/(loan-accounts(?:\/|$)|customers\/succession-service-actions)/),
  rule("FST-008", /^\/(payments|payment-|bank-statements|bank-reconciliations|reconciliations|suspense|refunds|accounting\/(gl-reconciliations|reconciliation-certifications)|loan-accounts\/[^/]+\/(repayments|payments|refunds))/),
  rule("FST-009", /^\/(finance|journals|general-ledger|eod|period-close|accounting\/(?!tax\/|funding)|completion\/partner-finance|channels\/commission)/),
  rule("FST-010", /^\/(gst|tds|tax|accounting\/tax)/),
  rule("FST-011", /^\/(treasury|funding|settlements|accounting\/funding)/),
  rule("FST-012", /^\/(collections|recovery-agents|collection-strategies)/),
  rule("FST-013", /^\/(cash-collections|field-collections)/),
  rule("FST-014", /^\/(complaints|grievances|ombudsman)/),
  rule("FST-015", /^\/(legal-recovery-cases|possession|auctions|customers\/succession|completion\/succession)/),
  rule("FST-016", /^\/(collateral|security-interests|cersai)/),
  rule("FST-017", /^\/(regulatory-returns|regulatory-reporting|reports\/regulatory|reporting\/(?!cic|ckycrr))/),
  rule("FST-018", /^\/(aml|fiu|transaction-monitoring)/),
  rule("FST-019", /^\/(cic|credit-bureau|credit-reporting|reporting\/cic)/),
  rule("FST-020", /^\/(models|model-governance|model-monitoring)/),
  rule("FST-021", /^\/(privacy|erasure-requests|data-retention|data-disclosures|customers\/(relationships|merge-plans|preferences)|completion\/customer-identity|borrowers\/[^/]+\/(access-requests|correction-requests))/),
  rule("FST-022", /^\/(integrations|providers|admin\/(integrations|conformance)|account-aggregator|communications)/),
  rule("FST-023", /^\/(vendors|outsourcing|sub-processors|lending-service-providers|digital-lending-apps|dlg-arrangements|channels\/(partners|commission-policies)|completion\/channel)/),
  rule("FST-024", /^\/(security|admin\/security|audit-access|activity\/exports)/),
  rule("FST-025", /^\/(incidents|cyber-incidents|security-operations)/),
  rule("FST-026", /^\/(changes|releases|deployments)/),
  rule("FST-027", /^\/(continuity|disaster-recovery|dr-exercises|failover)/),
  rule("FST-028", /^\/(implementation|migrations|cutovers)/),
  rule("FST-029", /^\/(assurance|internal-audit|governance|institution|regulated-entities)/),
  rule("FST-030", /^\/(subscriptions|tenant-products|admin\/products)/),
  rule("FST-031", /^\/(tenant-provisioning|onboarding|handover|activation|admin\/tenant-activation|sandbox-environments|workflow|completion\/operations)/),
  rule("FST-032", /^\/(co-lending|co-lending-arrangements)/),
  rule("FST-033", /^\/(fraud|fraud-cases|fraud-signals)/),
  rule("FST-034", /^\/(ai|agents|model-actions)/)
]);

export function universalStaffingMode(env = process.env) {
  const mode = env.LOANOS_UNIVERSAL_STAFFING ?? "off";
  return ["off", "shadow", "active"].includes(mode) ? mode : "off";
}

export function classifyProtectedMutation(method, path) {
  if (!MUTATION_METHODS.has(String(method).toUpperCase())) return null;
  if (SELF_GOVERNED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) return { disposition: "self_governed", featureId: path.startsWith("/admin/identity-governance/") ? "FST-001" : null };
  const match = MUTATION_STAFFING_ROUTE_RULES.find((candidate) => candidate.pattern.test(path));
  return match ? { disposition: "classified", featureId: match.featureId } : { disposition: "unclassified", featureId: null };
}

export async function enforceUniversalMutationStaffing({ state, tenantId, authContext, method, path, requestId, env = process.env, decide = decidePlatformControlStaffing }) {
  const mode = universalStaffingMode(env);
  const classification = classifyProtectedMutation(method, path);
  if (!classification) return { enforced: false, allowed: true, mode, reason: "read_only" };
  if (mode === "off") return { enforced: false, allowed: true, mode, reason: "enforcement_disabled", classification };
  if (!["tenant_user"].includes(authContext?.principalType)) return { enforced: false, allowed: true, mode, reason: "non_staff_principal", classification };
  if (classification.disposition === "self_governed") return { enforced: false, allowed: true, mode, reason: "self_governed_control", classification };
  if (classification.disposition === "unclassified") return { enforced: mode === "active", allowed: mode !== "active", mode, reason: "mutation_unclassified", classification };
  const policy = FEATURE_STAFFING_POLICIES[classification.featureId];
  let local = null;
  for (const requiredRoleId of [...new Set(policy.requiredRoleSets.flat())]) {
    try {
      const candidate = authorizeStaffedFeatureAction(state, { tenantId, featureId: classification.featureId, principalId: authContext.userId, requiredRoleId });
      if (!local || candidate.outcome === "allow") local = { ...candidate, requiredRoleId };
      if (candidate.outcome === "allow") break;
    } catch (error) {
      local ??= { outcome: "deny", reason: error.code ?? "staffing_evaluation_failed", readiness: null, requiredRoleId };
    }
  }
  const readiness = local?.readiness ?? { configured: false, requestedStatus: "disabled", ready: false, blockers: ["staffing_evaluation_failed"], missingRoleSets: [], independentPairs: [], sodViolations: [], distinctPrincipalIds: [], minimumDistinctPrincipals: policy.minimumDistinctPrincipals, operationalPauses: [] };
  const remote = await decide({ tenantId, requestId: `${requestId}:${classification.featureId}`, readiness, actorAuthorized: local?.outcome === "allow", agentAttemptsHumanControl: false, env });
  const wouldAllow = local?.outcome === "allow" && remote.decision === "allow";
  return { enforced: mode === "active", allowed: mode === "active" ? wouldAllow : true, wouldAllow, mode, reason: wouldAllow ? "staffing_authorized" : local?.reason ?? "staffing_denied", classification, local, controlDecision: remote };
}

function rule(featureId, pattern) { return Object.freeze({ featureId, pattern }); }
