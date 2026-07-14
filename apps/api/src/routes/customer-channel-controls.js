import {
  buildCustomer360,
  createChannelLead,
  createCustomerMergePlan,
  createSuccessionCase,
  recordCustomerPreferences,
  registerChannelPartner,
  registerCustomerRelationship,
  registerPartnerCommissionPolicy,
  transitionChannelLead,
  transitionSuccessionCase
} from "../../../../packages/core/src/index.js";

export async function routeCustomerChannelControls(context) {
  const { method, path, req, res, store, readJson, sendJson, appendEvent, authContext, hasTenantAdminRole, authActor } = context;
  if (!path.startsWith("/channels/") && !path.startsWith("/customers/")) return false;
  const allowed = method === "GET" ? ["tenant_admin", "security_admin", "auditor", "operator"] : ["tenant_admin", "security_admin", "operator"];
  if (!hasTenantAdminRole(authContext, allowed)) { sendJson(res, 403, { error: { code: "customer_channel_forbidden", message: "Customer or channel operations access is required." } }); return true; }
  const state = await store.load();
  if (method === "GET" && path === "/channels/operations") { sendJson(res, 200, projection(state)); return true; }
  const viewMatch = path.match(/^\/customers\/([^/]+)\/360$/); if (method === "GET" && viewMatch) { try { sendJson(res, 200, buildCustomer360(state, decodeURIComponent(viewMatch[1]))); } catch (cause) { sendJson(res, 404, { error: { code: cause.code, message: cause.message } }); } return true; }
  if (method !== "POST") return false; const body = await readJson(req); const actor = authActor(authContext);
  try {
    if (body.approvedBy && body.approvedBy !== actor) { sendJson(res, 403, { error: { code: "customer_channel_actor_mismatch", message: "approvedBy must be the authenticated actor." } }); return true; }
    let record; let nextState; let event;
    if (path === "/channels/partners") { const result = registerChannelPartner(state.channelPartners, state, body); record = result.partner; nextState = { ...state, channelPartners: result.registry }; event = "channel.partner.registered"; }
    else if (path === "/channels/commission-policies") { const result = registerPartnerCommissionPolicy(state.partnerCommissionPolicies, state, body); record = result.policy; nextState = { ...state, partnerCommissionPolicies: result.registry }; event = "channel.commission_policy.approved"; }
    else if (path === "/channels/leads") { const result = createChannelLead(state.channelLeads, state, { ...body, createdBy: actor }); record = result.lead; nextState = { ...state, channelLeads: result.registry }; event = "channel.lead.created"; }
    else if (path === "/customers/relationships") { const result = registerCustomerRelationship(state.customerRelationships, state, body); record = result.relationship; nextState = { ...state, customerRelationships: result.registry }; event = "customer.relationship.registered"; }
    else if (path === "/customers/merge-plans") { const result = createCustomerMergePlan(state.customerMergePlans, state, body); record = result.plan; nextState = { ...state, customerMergePlans: result.registry }; event = "customer.merge_plan.approved"; }
    else if (path === "/customers/preferences") { const result = recordCustomerPreferences(state.customerPreferences, state, { ...body, recordedBy: actor }); record = result.preferences; nextState = { ...state, customerPreferences: result.registry }; event = "customer.preferences.recorded"; }
    else if (path === "/customers/succession-cases") { const result = createSuccessionCase(state.successionCases, state, { ...body, reportedBy: actor }); record = result.successionCase; nextState = { ...state, successionCases: result.registry }; event = "customer.succession.reported"; }
    else { const leadMatch = path.match(/^\/channels\/leads\/([^/]+)\/transitions$/); const successionMatch = path.match(/^\/customers\/succession-cases\/([^/]+)\/transitions$/); if (leadMatch) { const id = decodeURIComponent(leadMatch[1]); record = transitionChannelLead(state.channelLeads[id], { ...body, actor }); nextState = { ...state, channelLeads: { ...state.channelLeads, [id]: record } }; event = "channel.lead.transitioned"; } else if (successionMatch) { const id = decodeURIComponent(successionMatch[1]); record = transitionSuccessionCase(state.successionCases[id], { ...body, actor }); nextState = { ...state, successionCases: { ...state.successionCases, [id]: record } }; event = "customer.succession.transitioned"; } else return false; }
    const id = record.partnerId ?? record.policyId ?? record.leadId ?? record.relationshipId ?? record.mergePlanId ?? record.borrowerId ?? record.caseId;
    await store.save(appendEvent(nextState, { type: event, resourceId: id, status: record.status, evidenceChecksumSha256: record.evidenceChecksumSha256, actor })); sendJson(res, 201, record); return true;
  } catch (cause) { sendJson(res, cause.code?.includes("duplicate") ? 409 : 422, { error: { code: cause.code ?? "customer_channel_invalid", message: cause.message } }); return true; }
}

function projection(state) { return { lendingProgrammes: Object.values(state.lendingProgrammes).filter((item) => item.status === "active").map(({ programmeId, name, productPolicyIds, channels }) => ({ programmeId, name, productPolicyIds, channels })), channelPartners: Object.values(state.channelPartners), partnerCommissionPolicies: Object.values(state.partnerCommissionPolicies), channelLeads: Object.values(state.channelLeads), customerRelationships: Object.values(state.customerRelationships), customerMergePlans: Object.values(state.customerMergePlans), customerPreferences: Object.values(state.customerPreferences), successionCases: Object.values(state.successionCases) }; }
