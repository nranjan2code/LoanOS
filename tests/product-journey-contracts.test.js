import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCT_JOURNEY_TYPES } from "@loanos/core/journeys/product-journey-administration.js";
import {
  getProductJourneyContract, PRODUCT_CONTRACT_CHANNELS, PRODUCT_CONTRACT_VERSION,
  PRODUCT_JOURNEY_CONTRACTS, PRODUCT_JOURNEY_CONTRACT_TYPES, validateProductJourneyContracts
} from "@loanos/core/journeys/product-journey-contracts.js";

test("the versioned product contract catalogue covers exactly all 21 canonical journeys", () => {
  assert.equal(PRODUCT_CONTRACT_VERSION, 1);
  assert.deepEqual(PRODUCT_JOURNEY_CONTRACT_TYPES, [...PRODUCT_JOURNEY_TYPES].sort());
  assert.deepEqual(validateProductJourneyContracts(), { valid: true, contractVersion: 1, journeyCount: 21, errors: [] });
  for (const journeyType of PRODUCT_JOURNEY_TYPES) {
    const contract = getProductJourneyContract(journeyType);
    assert.equal(contract.contractId, `product-journey/${journeyType}`);
    assert.equal(contract.checksumSha256.length, 64);
    assert.deepEqual(Object.keys(contract.channelActions), PRODUCT_CONTRACT_CHANNELS);
    assert.equal(contract.administrationSections.length, 12);
    assert.equal(contract.whiteLabelContentKeys.length, 14);
    assert.equal(Object.isFrozen(contract), true);
  }
});

test("every journey has a product-specific fact and evidence contract", () => {
  const signatures = Object.values(PRODUCT_JOURNEY_CONTRACTS).map((contract) => `${contract.requiredFacts.join("|")}::${contract.requiredEvidence.join("|")}`);
  assert.equal(new Set(signatures).size, 21);
  assert.ok(getProductJourneyContract("green_equipment_finance").requiredFacts.includes("green_taxonomy_evidence_ref"));
  assert.ok(getProductJourneyContract("commercial_vehicle_finance").requiredFacts.includes("permit_ref"));
  assert.ok(getProductJourneyContract("professional_practice_loan").requiredFacts.includes("professional_registration_ref"));
  assert.ok(getProductJourneyContract("home_loan").requiredEvidence.includes("stage_certificate"));
  assert.ok(getProductJourneyContract("gold_loan").requiredFacts.includes("auction_policy_ref"));
  assert.ok(getProductJourneyContract("education_loan").requiredFacts.includes("admission_verified"));
  assert.ok(getProductJourneyContract("microfinance_group_lending").requiredFacts.includes("no_coercion_attestation_ref"));
  assert.ok(getProductJourneyContract("consumer_durable_finance").requiredFacts.includes("merchant_verified"));
});

test("trade, co-lending, and revolving contracts remain materially distinct", () => {
  assert.ok(getProductJourneyContract("invoice_discounting").requiredFacts.includes("assignment_acknowledgement_ref"));
  assert.ok(getProductJourneyContract("purchase_order_finance").requiredFacts.includes("fulfilment_milestones"));
  assert.ok(getProductJourneyContract("supply_chain_finance").requiredFacts.includes("anchor_ref"));
  assert.ok(getProductJourneyContract("trade_finance_workflow").requiredFacts.includes("sanctions_screening_ref"));
  assert.ok(getProductJourneyContract("co_lending_programme").lifecycleCapabilities.includes("waterfall_settlement"));
  assert.ok(getProductJourneyContract("msme_working_capital").lifecycleCapabilities.includes("drawing_power_recalculation"));
});

test("validation rejects missing contracts, altered content, and incomplete channel authority", () => {
  const missing = structuredClone(PRODUCT_JOURNEY_CONTRACTS);
  delete missing.gold_loan;
  assert.equal(validateProductJourneyContracts(missing).valid, false);

  const altered = structuredClone(PRODUCT_JOURNEY_CONTRACTS);
  altered.home_loan.requiredFacts.pop();
  assert.ok(validateProductJourneyContracts(altered).errors.includes("home_loan: checksum is invalid."));

  const noControl = structuredClone(PRODUCT_JOURNEY_CONTRACTS);
  noControl.personal_loan.channelActions.control = [];
  assert.ok(validateProductJourneyContracts(noControl).errors.includes("personal_loan: control actions are required."));
});

test("unknown journey types fail closed with no compatibility aliases", () => {
  assert.throws(() => getProductJourneyContract("personal-loan"), { code: "product_contract_not_found" });
  assert.throws(() => getProductJourneyContract("legacy_personal_loan"), { code: "product_contract_not_found" });
});
