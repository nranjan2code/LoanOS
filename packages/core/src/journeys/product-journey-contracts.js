import { createHash } from "node:crypto";

/**
 * Greenfield product contracts. These are the single product-facing contract
 * consumed by channel applications; an archetype is only an implementation
 * aid and never substitutes for a product definition.
 */
export const PRODUCT_CONTRACT_VERSION = 1;
export const PRODUCT_CONTRACT_CHANNELS = Object.freeze(["borrower", "partner", "field", "branch", "credit", "operations", "control"]);

const ADMINISTRATION_SECTIONS = Object.freeze([
  "identity_and_regulated_entity", "availability_and_channels", "eligibility_and_policy", "pricing_and_kfs",
  "documents_and_evidence", "providers_and_integrations", "roles_and_four_eyes", "accounting_and_settlement",
  "servicing_collections_and_closure", "compliance_reporting_and_audit", "brand_content_and_languages", "release_and_readiness"
]);
const WHITE_LABEL_CONTENT_KEYS = Object.freeze([
  "product.name", "product.short_name", "product.description", "product.purpose_help", "product.eligibility_help",
  "product.document_help", "product.fees_help", "product.repayment_help", "product.disclosures", "product.support_help",
  "product.grievance_help", "product.status_labels", "product.notification_content", "product.document_content"
]);
const LIFECYCLE = Object.freeze(["draft", "submitted", "identity_verified", "underwriting", "approved", "contracted", "disbursed", "active", "delinquent", "restructured", "closed", "cancelled"]);
const CHANNEL_ACTIONS = Object.freeze({
  borrower: ["save_draft", "submit_application", "provide_information", "accept_kfs", "sign_contract", "view_status"],
  partner: ["save_assisted_draft", "submit_assisted_application", "provide_partner_evidence", "view_attributed_status"],
  field: ["capture_offline_draft", "synchronise_draft", "record_visit", "submit_field_evidence"],
  branch: ["create_assisted_application", "request_information", "verify_originals", "submit_application"],
  credit: ["propose_assessment", "refer_assessment", "approve_assessment", "decline_assessment", "record_exception"],
  operations: ["verify_conditions", "prepare_contract", "authorise_disbursement", "service_account", "close_account"],
  control: ["review_audit", "review_exception", "suspend_product", "export_regulatory_evidence"]
});

const defs = {
  personal_loan: d("term_lending", ["employment_type", "monthly_income_paise", "existing_obligations_paise", "salary_account_ref", "bureau_consent_ref"], ["income_evidence", "bank_statement", "bureau_report"], "term_loan", "unsecured", ["emi_servicing", "autopay_mandate", "prepayment", "foreclosure"]),
  msme_term_loan: d("business_term", ["legal_entity_ref", "promoter_refs", "udyam_registration_ref", "gst_registration_ref", "annual_turnover_paise", "business_vintage_months", "cashflow_assessment_ref", "end_use_code"], ["entity_registration", "udyam_evidence", "gst_returns", "bank_statement", "financial_statements", "end_use_evidence"], "term_loan", "unsecured_or_secured", ["business_cashflow_review", "end_use_monitoring", "emi_servicing"]),
  professional_practice_loan: d("professional_term", ["profession_code", "professional_registration_ref", "registration_active", "practice_vintage_months", "practice_receipts_paise", "practice_cashflow_assessment_ref", "end_use_code"], ["professional_registration", "practice_bank_statement", "income_tax_returns", "end_use_evidence"], "term_loan", "unsecured_or_secured", ["registration_reverification", "practice_cashflow_review", "emi_servicing"]),
  secured_business_loan: d("property_secured", ["legal_entity_ref", "promoter_refs", "business_cashflow_assessment_ref", "property_ref", "owner_refs", "title_search_ref", "valuation_ref", "market_value_paise", "proposed_ltv_bps", "security_perfection_ref", "end_use_code"], ["entity_registration", "financial_statements", "title_report", "valuation_report", "insurance_evidence", "cersai_evidence"], "term_loan", "mortgage", ["security_perfection", "end_use_monitoring", "collateral_monitoring", "emi_servicing"]),
  loan_against_property: d("property_secured", ["property_ref", "owner_refs", "occupancy_code", "title_search_ref", "encumbrance_status", "valuation_ref", "market_value_paise", "proposed_ltv_bps", "mortgage_ref", "end_use_code"], ["ownership_evidence", "title_report", "encumbrance_evidence", "valuation_report", "insurance_evidence", "cersai_evidence"], "term_loan", "mortgage", ["security_perfection", "collateral_revaluation", "insurance_tracking", "security_release"]),
  home_loan: d("property_secured", ["property_ref", "transaction_type", "seller_or_developer_ref", "rera_project_ref", "agreement_value_paise", "customer_contribution_paise", "title_search_ref", "valuation_ref", "market_value_paise", "proposed_ltv_bps", "construction_stage_code"], ["sale_agreement", "title_report", "valuation_report", "rera_evidence", "contribution_evidence", "stage_certificate", "insurance_evidence", "cersai_evidence"], "term_loan", "mortgage", ["stage_based_disbursement", "security_perfection", "construction_monitoring", "emi_servicing", "security_release"]),
  equipment_machinery_finance: d("asset_finance", ["asset_category", "manufacturer_ref", "supplier_ref", "quotation_ref", "invoice_ref", "asset_cost_paise", "customer_contribution_paise", "serial_number", "installation_required", "installation_certificate_ref"], ["supplier_due_diligence", "quotation", "invoice", "contribution_evidence", "delivery_evidence", "installation_certificate", "insurance_evidence"], "term_loan", "asset_charge", ["supplier_payment", "delivery_confirmation", "installation_confirmation", "asset_monitoring"]),
  green_equipment_finance: d("green_asset_finance", ["asset_category", "manufacturer_ref", "supplier_ref", "quotation_ref", "asset_cost_paise", "green_taxonomy_code", "green_taxonomy_evidence_ref", "estimated_impact_metric", "subsidy_or_incentive_ref", "installation_certificate_ref"], ["supplier_due_diligence", "quotation", "green_taxonomy_evidence", "impact_baseline", "delivery_evidence", "installation_certificate"], "term_loan", "asset_charge", ["supplier_payment", "taxonomy_reverification", "impact_reporting", "subsidy_reconciliation"]),
  personal_vehicle_loan: d("vehicle_finance", ["vehicle_class", "manufacturer_ref", "dealer_ref", "quotation_ref", "on_road_price_paise", "customer_contribution_paise", "registration_plan_ref", "insurance_plan_ref", "vehicle_identification_number"], ["dealer_verification", "quotation", "contribution_evidence", "delivery_evidence", "registration_certificate", "insurance_evidence"], "term_loan", "hypothecation", ["dealer_payment", "delivery_confirmation", "registration_tracking", "insurance_tracking", "hypothecation_release"]),
  commercial_vehicle_finance: d("commercial_vehicle_finance", ["vehicle_class", "dealer_ref", "quotation_ref", "on_road_price_paise", "permit_type", "permit_ref", "route_or_use_code", "fleet_size", "vehicle_cashflow_assessment_ref", "vehicle_identification_number"], ["dealer_verification", "quotation", "commercial_permit", "cashflow_evidence", "registration_certificate", "insurance_evidence"], "term_loan", "hypothecation", ["dealer_payment", "permit_tracking", "registration_tracking", "vehicle_cashflow_review", "hypothecation_release"]),
  gold_loan: d("gold_custody", ["packet_ref", "gross_weight_grams", "stone_weight_grams", "net_eligible_weight_grams", "purity_karat", "assessed_rate_paise_per_gram", "collateral_value_paise", "proposed_ltv_bps", "vault_location_ref", "auction_policy_ref"], ["assay_report", "packet_seal_evidence", "custody_receipt", "vault_movement_evidence", "auction_notice_evidence"], "demand_or_term_loan", "gold_pledge", ["dual_control_custody", "daily_ltv_monitoring", "margin_call", "auction", "dual_control_release"]),
  education_loan: d("education_finance", ["student_ref", "co_borrower_refs", "institution_ref", "course_code", "admission_ref", "admission_verified", "course_cost_paise", "fee_schedule_ref", "customer_contribution_paise", "moratorium_months"], ["admission_letter", "institution_verification", "fee_schedule", "academic_records", "co_borrower_income_evidence", "visa_evidence_if_applicable"], "term_loan", "unsecured_or_collateral", ["institution_direct_payment", "fee_tranches", "academic_progress_tracking", "moratorium_management"]),
  agriculture_allied_finance: d("seasonal_field", ["farmer_ref", "land_or_activity_ref", "tenure_code", "crop_or_activity_code", "season_code", "acreage_decimal", "geo_evidence_ref", "harvest_date", "seasonal_cashflow_ref", "weather_risk_ref", "price_risk_ref"], ["land_or_tenancy_record", "field_inspection", "crop_plan", "seasonal_cashflow", "crop_insurance", "geo_evidence"], "seasonal_or_term_loan", "crop_or_asset_charge", ["offline_field_service", "seasonal_disbursement", "crop_stage_monitoring", "calamity_restructure", "seasonal_repayment"]),
  microfinance_group_lending: d("group_field", ["group_ref", "centre_ref", "member_refs", "group_resolution_ref", "household_income_paise", "household_indebtedness_paise", "repayment_capacity_paise", "group_conduct_ref", "no_coercion_attestation_ref"], ["member_identity_evidence", "household_assessment", "group_resolution", "group_training_evidence", "conduct_attestation"], "group_term_loan", "joint_liability_or_unsecured", ["offline_centre_service", "group_training", "centre_collection", "household_indebtedness_monitoring", "conduct_monitoring"]),
  consumer_durable_finance: d("merchant_pos", ["merchant_ref", "merchant_verified", "sku_ref", "invoice_ref", "invoice_amount_paise", "financed_amount_paise", "down_payment_paise", "delivery_otp_ref", "serial_number"], ["merchant_verification", "merchant_invoice", "down_payment_evidence", "delivery_confirmation", "warranty_evidence"], "point_of_sale_term_loan", "unsecured_or_asset_charge", ["merchant_settlement", "delivery_confirmation", "cancellation_and_refund", "returns_reconciliation"]),
  invoice_discounting: d("trade_receivables", ["seller_ref", "buyer_ref", "invoice_ref", "invoice_date", "invoice_due_date", "face_value_paise", "assignment_acknowledgement_ref", "advance_rate_bps", "concentration_limit_bps", "dispute_status"], ["invoice", "buyer_acceptance", "assignment_acknowledgement", "goods_or_service_evidence", "settlement_evidence"], "receivables_facility", "receivables_assignment", ["trade_asset_verification", "drawdown", "buyer_collection", "settlement_allocation", "dispute_management"]),
  purchase_order_finance: d("trade_receivables", ["seller_ref", "buyer_ref", "purchase_order_ref", "order_value_paise", "cost_estimate_paise", "expected_margin_paise", "shipment_ref", "incoterm_code", "destination_code", "fulfilment_milestones"], ["purchase_order", "buyer_verification", "cost_evidence", "shipment_evidence", "buyer_acceptance", "settlement_evidence"], "transaction_facility", "purchase_order_assignment", ["milestone_drawdown", "shipment_monitoring", "buyer_cancellation_management", "settlement_allocation"]),
  supply_chain_finance: d("supply_chain_programme", ["anchor_ref", "programme_ref", "participant_ref", "trade_asset_ref", "face_value_paise", "erp_confirmation_ref", "programme_limit_paise", "participant_limit_paise", "concentration_limit_bps", "due_date"], ["anchor_agreement", "participant_onboarding", "trade_asset", "erp_confirmation", "buyer_acceptance", "settlement_evidence"], "programme_receivables_facility", "receivables_assignment", ["anchor_programme_administration", "dynamic_limit_management", "drawdown", "anchor_collection", "programme_reconciliation"]),
  trade_finance_workflow: d("trade_finance", ["applicant_ref", "beneficiary_ref", "instrument_type", "instrument_ref", "currency_code", "amount_minor_units", "shipment_ref", "incoterm_code", "customs_reference", "sanctions_screening_ref", "discrepancy_status"], ["trade_instrument", "shipment_documents", "customs_evidence", "sanctions_screening", "beneficiary_evidence", "discrepancy_record"], "contingent_or_funded_trade_facility", "trade_instrument_security", ["instrument_issuance", "swift_messaging", "document_examination", "discrepancy_management", "contingent_accounting"]),
  co_lending_programme: d("co_lending", ["arrangement_ref", "originator_ref", "partner_lender_refs", "originator_share_bps", "partner_share_bps", "first_loss_support_ref", "escrow_account_ref", "waterfall_ref", "programme_limit_paise", "participant_allocation_ref"], ["co_lending_agreement", "lender_due_diligence", "allocation_statement", "escrow_evidence", "waterfall_definition", "reconciliation_evidence"], "allocated_loan_facility", "shared_or_participated_security", ["participant_allocation", "multi_lender_disbursement", "subledger_accounting", "waterfall_settlement", "lender_reconciliation"]),
  msme_working_capital: d("revolving_working_capital", ["legal_entity_ref", "udyam_registration_ref", "gst_registration_ref", "facility_type", "facility_limit_paise", "stock_value_paise", "eligible_receivables_paise", "drawing_power_paise", "stock_statement_date", "renewal_date", "primary_security_ref"], ["entity_registration", "udyam_evidence", "gst_returns", "stock_statement", "receivables_ageing", "bank_statement", "stock_audit", "security_evidence"], "revolving_credit_facility", "current_assets_charge", ["revolving_drawdown", "drawing_power_recalculation", "statement_monitoring", "limit_review", "annual_renewal", "cash_credit_closure"])
};

export const PRODUCT_JOURNEY_CONTRACTS = deepFreeze(Object.fromEntries(Object.entries(defs).map(([journeyType, definition]) => {
  const core = { contractId: `product-journey/${journeyType}`, contractVersion: PRODUCT_CONTRACT_VERSION, journeyType, ...definition };
  return [journeyType, { ...core, checksumSha256: hash(core) }];
})));
export const PRODUCT_JOURNEY_CONTRACT_TYPES = Object.freeze(Object.keys(PRODUCT_JOURNEY_CONTRACTS).sort());

export function getProductJourneyContract(journeyType) {
  const contract = PRODUCT_JOURNEY_CONTRACTS[journeyType];
  if (!contract) throw Object.assign(new Error("A canonical product journey contract is required."), { code: "product_contract_not_found" });
  return contract;
}

export function validateProductJourneyContracts(contracts = PRODUCT_JOURNEY_CONTRACTS) {
  const errors = [];
  const entries = Object.entries(contracts ?? {});
  if (entries.length !== 21) errors.push("Exactly 21 product journey contracts are required.");
  for (const [journeyType, contract] of entries) {
    if (contract?.journeyType !== journeyType) errors.push(`${journeyType}: journeyType mismatch.`);
    if (contract?.contractId !== `product-journey/${journeyType}` || contract?.contractVersion !== PRODUCT_CONTRACT_VERSION) errors.push(`${journeyType}: contract identity is invalid.`);
    for (const key of ["archetype", "requiredFacts", "requiredEvidence", "channelActions", "administrationSections", "lifecycleCapabilities", "facility", "security", "whiteLabelContentKeys"]) if (contract?.[key] == null) errors.push(`${journeyType}: ${key} is required.`);
    if (!uniqueNonEmpty(contract?.requiredFacts)) errors.push(`${journeyType}: requiredFacts must be unique and non-empty.`);
    if (!uniqueNonEmpty(contract?.requiredEvidence)) errors.push(`${journeyType}: requiredEvidence must be unique and non-empty.`);
    if (!uniqueNonEmpty(contract?.administrationSections) || !sameSet(contract?.administrationSections, ADMINISTRATION_SECTIONS)) errors.push(`${journeyType}: administrationSections are incomplete.`);
    if (!uniqueNonEmpty(contract?.whiteLabelContentKeys) || !sameSet(contract?.whiteLabelContentKeys, WHITE_LABEL_CONTENT_KEYS)) errors.push(`${journeyType}: whiteLabelContentKeys are incomplete.`);
    if (!uniqueNonEmpty(contract?.lifecycleCapabilities) || !LIFECYCLE.every((stage) => contract.lifecycleCapabilities.includes(stage))) errors.push(`${journeyType}: lifecycleCapabilities are incomplete.`);
    if (!contract?.accounting?.principalLedger || !contract?.accounting?.interestLedger || !contract?.accounting?.feeLedger || !contract?.accounting?.suspenseLedger) errors.push(`${journeyType}: accounting properties are incomplete.`);
    for (const channel of PRODUCT_CONTRACT_CHANNELS) if (!uniqueNonEmpty(contract?.channelActions?.[channel])) errors.push(`${journeyType}: ${channel} actions are required.`);
    const { checksumSha256, ...core } = contract ?? {};
    if (!/^[a-f0-9]{64}$/.test(checksumSha256 ?? "") || checksumSha256 !== hash(core)) errors.push(`${journeyType}: checksum is invalid.`);
  }
  return Object.freeze({ valid: errors.length === 0, contractVersion: PRODUCT_CONTRACT_VERSION, journeyCount: entries.length, errors: Object.freeze(errors) });
}

function d(archetype, requiredFacts, requiredEvidence, facilityType, securityType, servicingCapabilities) {
  return {
    archetype, requiredFacts, requiredEvidence,
    channelActions: Object.fromEntries(Object.entries(CHANNEL_ACTIONS).map(([channel, actions]) => [channel, [...actions]])),
    administrationSections: [...ADMINISTRATION_SECTIONS],
    lifecycleCapabilities: [...LIFECYCLE, ...servicingCapabilities],
    facility: { type: facilityType, exactMoneyRepresentation: "decimal_string_minor_units", limitEnforcement: "decision_engine_fail_closed", disbursementRequiresDualControl: true },
    security: { type: securityType, tenantIsolation: "tenant_runtime_and_rls", evidenceBeforeDisbursement: true, releaseRequiresDualControl: securityType !== "unsecured" },
    accounting: { principalLedger: `${facilityType}.principal`, interestLedger: `${facilityType}.interest`, feeLedger: `${facilityType}.fees`, suspenseLedger: `${facilityType}.suspense`, postingMode: "double_entry_idempotent" },
    whiteLabelContentKeys: [...WHITE_LABEL_CONTENT_KEYS]
  };
}
function uniqueNonEmpty(value) { return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0) && new Set(value).size === value.length; }
function sameSet(left, right) { return left?.length === right.length && right.every((item) => left.includes(item)); }
function hash(value) { return createHash("sha256").update(stable(value)).digest("hex"); }
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

export { ADMINISTRATION_SECTIONS as PRODUCT_CONTRACT_ADMINISTRATION_SECTIONS, WHITE_LABEL_CONTENT_KEYS as PRODUCT_CONTRACT_WHITE_LABEL_CONTENT_KEYS };
