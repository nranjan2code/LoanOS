import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
  AUDIT_ACTOR_TYPES,
  DEMO_SHOWCASE_PROFILE_ID,
  applyShowcaseDemoProfile,
  buildAuditEvidencePack,
  buildShowcaseDemoProfile,
  createAiAgentPlatformState,
  createModelRegistryState,
  normalizeAiAgentPlatformState,
  normalizeModelRegistryState,
  normalizeWorkflowTaskStore,
  sealAuditChain,
  stampAuditEvents,
  verifyAuditChain
} from "../../../packages/core/src/index.js";
import {
  encryptTenantData,
  decryptTenantData,
  getActiveMasterKey,
  getMasterKeyById,
  isEncryptedEnvelope
} from "./encryption.js";
import {
  normalizeAccessReviews,
  normalizeLoginAttempts,
  normalizePlatformUsers,
  normalizeSessions,
  normalizeTenantUsers,
  upsertPlatformUser,
  upsertTenantUser
} from "./identity.js";

export const STATE_VERSION = 4;

// Modules default to enabled (opt-out): a tenant provisioned without an
// explicit module selection gets full access, matching pre-entitlement
// behavior. A platform admin narrows access by unchecking a module during
// onboarding; enforceModuleAccess() in server.js then gates the routes below.
export const TENANT_ONBOARDING_MODULES = [
  { id: "los", label: "Loan Origination", defaultEnabled: true },
  { id: "lms", label: "Loan Management", defaultEnabled: true },
  { id: "lws", label: "Workflow Studio", defaultEnabled: true },
  { id: "compliance", label: "Compliance Evidence", defaultEnabled: true },
  { id: "iam", label: "Identity and Access", defaultEnabled: true },
  { id: "ai_governance", label: "AI Governance", defaultEnabled: true },
  { id: "collections", label: "Collections and Recovery", defaultEnabled: true },
  { id: "marketplace", label: "Marketplace Offers", defaultEnabled: true },
  { id: "dlg", label: "Default Loss Guarantee", defaultEnabled: true },
  { id: "co_lending", label: "Co-Lending", defaultEnabled: true },
  { id: "integrations", label: "External Integrations", defaultEnabled: true }
];

export const TENANT_ONBOARDING_FLOWS = [
  { id: "borrower_onboarding", label: "Borrower Onboarding", defaultEnabled: true },
  { id: "kyc", label: "KYC and Consent", defaultEnabled: true },
  { id: "eligibility", label: "Eligibility and Underwriting", defaultEnabled: true },
  { id: "kfs", label: "KFS and Offer", defaultEnabled: true },
  { id: "maker_checker", label: "Maker-Checker Approval", defaultEnabled: true },
  { id: "document_execution", label: "Document Execution", defaultEnabled: true },
  { id: "disbursement", label: "Disbursement Guard", defaultEnabled: true },
  { id: "servicing", label: "Servicing and Statements", defaultEnabled: true },
  { id: "collections", label: "Collections", defaultEnabled: false },
  { id: "grievance", label: "Grievance Redressal", defaultEnabled: true },
  { id: "fraud", label: "Fraud Case Management", defaultEnabled: false },
  { id: "ai_handoff", label: "AI Human Handoff", defaultEnabled: false }
];

const DEFAULT_ONBOARDING_MODULES = TENANT_ONBOARDING_MODULES
  .filter((module) => module.defaultEnabled)
  .map((module) => module.id);
const DEFAULT_ONBOARDING_FLOWS = TENANT_ONBOARDING_FLOWS
  .filter((flow) => flow.defaultEnabled)
  .map((flow) => flow.id);
const MODULE_IDS = new Set(TENANT_ONBOARDING_MODULES.map((module) => module.id));
const FLOW_IDS = new Set(TENANT_ONBOARDING_FLOWS.map((flow) => flow.id));
const ONBOARDING_STATUSES = new Set(["draft", "configured", "ready", "needs_attention"]);

export function resolveDataDir() {
  return process.env.LOANOS_DATA_DIR || join(process.cwd(), ".loanos-data");
}

export function statePath(dataDir = resolveDataDir()) {
  return join(dataDir, "state.json");
}

// A tenant data plane holds one regulated entity's whole operating record. It is
// the shape every domain handler reads and writes; a handler is never handed
// more than one tenant's partition, so cross-tenant access is impossible by
// construction rather than by per-endpoint filtering.
export function createEmptyTenantData() {
  return {
    regulatedEntities: {},
    lendingServiceProviders: {},
    digitalLendingApps: {},
    productPolicies: {},
    borrowerProfiles: {},
    consentRecords: {},
    kycRecords: {},
    beneficialOwners: {},
    erasureRequests: {},
    dataDisclosures: {},
    recoveryAgents: {},
    dlgArrangements: {},
    coLendingArrangements: {},
    coLendingSettlementStatements: {},
    coLendingSettlementPayments: {},
    coLendingIntercompanyReconciliations: {},
    coLendingTaxExchanges: {},
    coLendingEscrowInstructions: {},
    accountAggregatorConsents: {},
    providerCertifications: {},
    providerCallbacks: {},
    auditAnchors: {},
    auditCompletenessReconciliations: {},
    evidenceCustody: {},
    dataLineage: {},
    dataQualityRules: {},
    dataQualityAssessments: {},
    dataQualityCertifications: {},
    federationPolicies: {},
    federationRotationRequests: {},
    federatedRevocationVerifierProfiles: {},
    federatedRevocationEvents: {},
    scimEvents: {},
    authenticatorRecoveryRequests: {},
    identityConformanceCampaigns: {},
    directoryReconciliations: {},
    identityOperationalRuns: {},
    identityOperationsDrills: {},
    identityOperationsJobs: {},
    identityOperationsWorkerRuns: {},
    identityOperationsDeadLetters: {},
    identityOperationsJobReplays: {},
    identityOperationsDeadLetterReplayRequests: {},
    identityOperationsAlerts: {},
    identityOperationsEscalations: {},
    conformanceCandidateProfiles: {},
    conformanceCampaigns: {},
    tenantActivationAssessments: {},
    activityExportBatches: {},
    screeningLists: {},
    cddReviews: {},
    transactionMonitoringRules: {},
    transactionMonitoringAssessments: {},
    amlAlerts: {},
    fraudRiskPolicies: {},
    fraudSignalAssessments: {},
    portfolioRiskSnapshots: {},
    portfolioStressTests: {},
    rcsaAssessments: {},
    modelMonitoringReports: {},
    riskCommitteePacks: {},
    implementationProjects: {},
    migrationMappings: {},
    migrationRuns: {},
    openingBalanceValidations: {},
    parallelRunAssessments: {},
    uatCampaigns: {},
    trainingCertifications: {},
    goLiveReadinessAssessments: {},
    cutoverRuns: {},
    hypercareReviews: {},
    institutionOperatingUnits: {},
    lendingProgrammes: {},
    regulatoryApplicabilityProfiles: {},
    complianceObligationCalendars: {},
    businessCalendars: {},
    workflowDefinitions: {},
    approvalMatrices: {},
    approvalResolutions: {},
    workforcePolicies: {},
    bulkActionPlans: {},
    exceptionTaxonomies: {},
    operationalExceptions: {},
    configuredWorkflowCases: {},
    channelPartners: {},
    partnerCommissionPolicies: {},
    partnerCommissionAssessments: {},
    channelLeads: {},
    customerRelationships: {},
    customerMergePlans: {},
    customerMergeExecutions: {},
    customerPreferences: {},
    successionCases: {},
    successionAuthorities: {},
    successionServiceActions: {},
    successionServiceExecutions: {},
    successionLegalReviews: {},
    successionOperationsPolicies: {},
    successionExternalInstructions: {},
    successionQueueAssignments: {},
    partnerOnboardings: {},
    partnerCredentials: {},
    fieldHierarchyUnits: {},
    territoryCapacityAllocations: {},
    partnerAccessCertifications: {},
    partnerConductCases: {},
    partnerFinanceInvoices: {},
    partnerPayables: {},
    partnerPaymentFiles: {},
    partnerPayments: {},
    partnerFinanceDisputes: {},
    partnerFinanceReversals: {},
    customerIdentityMerges: {},
    externalIdentityLinks: {},
    outbox: {},
    languagePacks: {},
    localizedTemplates: {},
    certifiedFieldDevices: {},
    encryptedOfflineWork: {},
    productionComponentAttestations: {},
    productionResilienceDrills: {},
    institutionConfigurations: {},
    sourceEtlRuns: {},
    operationalReadiness: {},
    independentAssuranceTests: {},
    governanceSignoffs: {},
    liveIntegrations: {},
    liveIntegrationConformance: {},
    tenantPlans: {},
    environmentPromotions: {},
    portabilityImports: {},
    tenantCommunications: {},
    riskPricingMatrices: {},
    productAddons: {},
    tenantProductSubscriptions: {},
    productAddonRequests: {},
    productAdminGrants: {},
    tenantCustomProducts: {},
    platformProductTemplates: {},
    productJourneyConformanceCampaigns: {},
    journeyWorkspaceDrafts: {},
    composedJourneyLifecycles: {},
    composedJourneyTransitionRequests: {},
    composedJourneyEscalations: {},
    specialistJourneyConfigurationRequests: {},
    specialistJourneyConfigurations: {},
    specialistJourneyCases: {},
    specialistJourneyActionRequests: {},
    specialistJourneyExceptions: {},
    specialistJourneyEscalations: {},
    specialisedJourneys: {},
    tradeJourneyPacks: {},
    tradeParties: {},
    tradeAssets: {},
    tradeTransactions: {},
    profitabilityParameters: {},
    physicalOriginalCustody: {},
    collateralRecords: {},
    multipartySignings: {},
    disbursementTranches: {},
    postDisbursementFollowups: {},
    servicingChanges: {},
    servicingDocuments: {},
    collectionStrategies: {},
    collectionTreatmentPlans: {},
    collectionPortfolioAllocations: {},
    collectionAgencySettlements: {},
    recoveryRepossessions: {},
    recoveryAuctions: {},
    recoveryAccounting: {},
    closureReleases: {},
    closureSlaAssessments: {},
    lspIncidents: {},
    servicingPortfolioTransfers: {},
    partnerOversightAssessments: {},
    grievanceRcaCapa: {},
    assistedComplaints: {},
    ombudsmanAwards: {},
    regulatoryReturns: {},
    governedConnectors: {},
    dataProducts: {},
    masterReferenceVersions: {},
    complaints: {},
    incidents: {},
    fraudCases: {},
    loanApplications: {},
    loanAccounts: {},
    legalRecoveryCases: {},
    securityInterests: {},
    accessRequests: {},
    correctionRequests: {},
    fiuReports: {},
    documentVault: {},
    communications: {},
    communicationDeliveries: {},
    providerCallbackDeliveries: {},
    signedFileSchemaProfiles: {},
    signedFileEnvelopes: {},
    signedFileTransports: {},
    businessAdapters: {},
    businessAdapterRequests: {},
    paymentRails: {},
    paymentReconciliations: {},
    bankReconciliations: {},
    paymentSuspenseReceipts: {},
    paymentSettlementFiles: {},
    reconciliationBreakAssignments: {},
    accountingPostingRuns: {},
    glDeliveries: {},
    glReconciliations: {},
    coreBankingDeliveries: {},
    financeExceptions: {},
    financeCloseSchedules: {},
    financeOperationalRuns: {},
    financePeriodClosures: {},
    reconciliationCertifications: {},
    businessDateClosures: {},
    eclProvisions: {},
    eclParameterSets: {},
    iracIncomeAdjustments: {},
    taxWithholdings: {},
    gstInvoices: {},
    gstCreditNotes: {},
    tdsCertificates: {},
    iracMemorandumInterest: {},
    iracRecoveryRecognitions: {},
    eirAmortizations: {},
    fundingFacilities: {},
    loanFundingAllocations: {},
    taxFilings: {},
    cicSubmissionBatches: {},
    cicCorrectionRequests: {},
    ckycrrSubmissions: {},
    ckycrrDownloads: {},
    workflowTasks: normalizeWorkflowTaskStore(),
    modelRegistry: createModelRegistryState(),
    aiAgentPlatform: createAiAgentPlatformState(),
    aiHandoffRequests: {},
    marketplaceOffers: {},
    users: {},
    accessReviews: {},
    saasPrincipals: {},
    saasRoleRequests: {},
    saasRoleGrants: {},
    tenantFeatureStaffingConfigs: {},
    staffingEscalations: {},
    featureStaffingRequests: {},
    staffingEscalationClosureRequests: {},
    tenantOwnership: {},
    bootstrapTransitionRequests: {},
    ownershipTransferRequests: {},
    emergencyAccessRequests: {},
    emergencyAccessGrants: {},
    accessActivityEvents: [],
    events: []
  };
}

function normalizeTenantData(data) {
  return {
    regulatedEntities: data?.regulatedEntities ?? {},
    lendingServiceProviders: data?.lendingServiceProviders ?? {},
    digitalLendingApps: data?.digitalLendingApps ?? {},
    productPolicies: data?.productPolicies ?? {},
    borrowerProfiles: data?.borrowerProfiles ?? {},
    consentRecords: data?.consentRecords ?? {},
    kycRecords: data?.kycRecords ?? {},
    beneficialOwners: data?.beneficialOwners ?? {},
    erasureRequests: data?.erasureRequests ?? {},
    dataDisclosures: data?.dataDisclosures ?? {},
    recoveryAgents: data?.recoveryAgents ?? {},
    dlgArrangements: data?.dlgArrangements ?? {},
    coLendingArrangements: data?.coLendingArrangements ?? {},
    coLendingSettlementStatements: data?.coLendingSettlementStatements ?? {},
    coLendingSettlementPayments: data?.coLendingSettlementPayments ?? {},
    coLendingIntercompanyReconciliations: data?.coLendingIntercompanyReconciliations ?? {},
    coLendingTaxExchanges: data?.coLendingTaxExchanges ?? {},
    coLendingEscrowInstructions: data?.coLendingEscrowInstructions ?? {},
    accountAggregatorConsents: data?.accountAggregatorConsents ?? {},
    providerCertifications: data?.providerCertifications ?? {},
    providerCallbacks: data?.providerCallbacks ?? {},
    auditAnchors: data?.auditAnchors ?? {},
    auditCompletenessReconciliations: data?.auditCompletenessReconciliations ?? {},
    evidenceCustody: data?.evidenceCustody ?? {},
    dataLineage: data?.dataLineage ?? {},
    dataQualityRules: data?.dataQualityRules ?? {},
    dataQualityAssessments: data?.dataQualityAssessments ?? {},
    dataQualityCertifications: data?.dataQualityCertifications ?? {},
    federationPolicies: data?.federationPolicies ?? {},
    federationRotationRequests: data?.federationRotationRequests ?? {},
    federatedRevocationVerifierProfiles: data?.federatedRevocationVerifierProfiles ?? {},
    federatedRevocationEvents: data?.federatedRevocationEvents ?? {},
    scimEvents: data?.scimEvents ?? {},
    authenticatorRecoveryRequests: data?.authenticatorRecoveryRequests ?? {},
    identityConformanceCampaigns: data?.identityConformanceCampaigns ?? {},
    directoryReconciliations: data?.directoryReconciliations ?? {},
    identityOperationalRuns: data?.identityOperationalRuns ?? {},
    identityOperationsDrills: data?.identityOperationsDrills ?? {},
    identityOperationsJobs: data?.identityOperationsJobs ?? {},
    identityOperationsWorkerRuns: data?.identityOperationsWorkerRuns ?? {},
    identityOperationsDeadLetters: data?.identityOperationsDeadLetters ?? {},
    identityOperationsJobReplays: data?.identityOperationsJobReplays ?? {},
    identityOperationsDeadLetterReplayRequests: data?.identityOperationsDeadLetterReplayRequests ?? {},
    identityOperationsAlerts: data?.identityOperationsAlerts ?? {},
    identityOperationsEscalations: data?.identityOperationsEscalations ?? {},
    conformanceCandidateProfiles: data?.conformanceCandidateProfiles ?? {},
    conformanceCampaigns: data?.conformanceCampaigns ?? {},
    tenantActivationAssessments: data?.tenantActivationAssessments ?? {},
    activityExportBatches: data?.activityExportBatches ?? {},
    screeningLists: data?.screeningLists ?? {},
    cddReviews: data?.cddReviews ?? {},
    transactionMonitoringRules: data?.transactionMonitoringRules ?? {},
    transactionMonitoringAssessments: data?.transactionMonitoringAssessments ?? {},
    amlAlerts: data?.amlAlerts ?? {},
    fraudRiskPolicies: data?.fraudRiskPolicies ?? {},
    fraudSignalAssessments: data?.fraudSignalAssessments ?? {},
    portfolioRiskSnapshots: data?.portfolioRiskSnapshots ?? {},
    portfolioStressTests: data?.portfolioStressTests ?? {},
    rcsaAssessments: data?.rcsaAssessments ?? {},
    modelMonitoringReports: data?.modelMonitoringReports ?? {},
    riskCommitteePacks: data?.riskCommitteePacks ?? {},
    implementationProjects: data?.implementationProjects ?? {},
    migrationMappings: data?.migrationMappings ?? {},
    migrationRuns: data?.migrationRuns ?? {},
    openingBalanceValidations: data?.openingBalanceValidations ?? {},
    parallelRunAssessments: data?.parallelRunAssessments ?? {},
    uatCampaigns: data?.uatCampaigns ?? {},
    trainingCertifications: data?.trainingCertifications ?? {},
    goLiveReadinessAssessments: data?.goLiveReadinessAssessments ?? {},
    cutoverRuns: data?.cutoverRuns ?? {},
    hypercareReviews: data?.hypercareReviews ?? {},
    institutionOperatingUnits: data?.institutionOperatingUnits ?? {},
    lendingProgrammes: data?.lendingProgrammes ?? {},
    regulatoryApplicabilityProfiles: data?.regulatoryApplicabilityProfiles ?? {},
    complianceObligationCalendars: data?.complianceObligationCalendars ?? {},
    businessCalendars: data?.businessCalendars ?? {},
    workflowDefinitions: data?.workflowDefinitions ?? {},
    approvalMatrices: data?.approvalMatrices ?? {},
    approvalResolutions: data?.approvalResolutions ?? {},
    workforcePolicies: data?.workforcePolicies ?? {},
    bulkActionPlans: data?.bulkActionPlans ?? {},
    exceptionTaxonomies: data?.exceptionTaxonomies ?? {},
    operationalExceptions: data?.operationalExceptions ?? {},
    configuredWorkflowCases: data?.configuredWorkflowCases ?? {},
    channelPartners: data?.channelPartners ?? {},
    partnerCommissionPolicies: data?.partnerCommissionPolicies ?? {},
    partnerCommissionAssessments: data?.partnerCommissionAssessments ?? {},
    channelLeads: data?.channelLeads ?? {},
    customerRelationships: data?.customerRelationships ?? {},
    customerMergePlans: data?.customerMergePlans ?? {},
    customerMergeExecutions: data?.customerMergeExecutions ?? {},
    customerPreferences: data?.customerPreferences ?? {},
    successionCases: data?.successionCases ?? {},
    successionAuthorities: data?.successionAuthorities ?? {},
    successionServiceActions: data?.successionServiceActions ?? {},
    successionServiceExecutions: data?.successionServiceExecutions ?? {},
    successionLegalReviews: data?.successionLegalReviews ?? {},
    successionOperationsPolicies: data?.successionOperationsPolicies ?? {},
    successionExternalInstructions: data?.successionExternalInstructions ?? {},
    successionQueueAssignments: data?.successionQueueAssignments ?? {},
    partnerOnboardings: data?.partnerOnboardings ?? {},
    partnerCredentials: data?.partnerCredentials ?? {},
    fieldHierarchyUnits: data?.fieldHierarchyUnits ?? {},
    territoryCapacityAllocations: data?.territoryCapacityAllocations ?? {},
    partnerAccessCertifications: data?.partnerAccessCertifications ?? {},
    partnerConductCases: data?.partnerConductCases ?? {},
    partnerFinanceInvoices: data?.partnerFinanceInvoices ?? {},
    partnerPayables: data?.partnerPayables ?? {},
    partnerPaymentFiles: data?.partnerPaymentFiles ?? {},
    partnerPayments: data?.partnerPayments ?? {},
    partnerFinanceDisputes: data?.partnerFinanceDisputes ?? {},
    partnerFinanceReversals: data?.partnerFinanceReversals ?? {},
    customerIdentityMerges: data?.customerIdentityMerges ?? {},
    externalIdentityLinks: data?.externalIdentityLinks ?? {},
    outbox: data?.outbox ?? {},
    languagePacks: data?.languagePacks ?? {},
    localizedTemplates: data?.localizedTemplates ?? {},
    certifiedFieldDevices: data?.certifiedFieldDevices ?? {},
    encryptedOfflineWork: data?.encryptedOfflineWork ?? {},
    productionComponentAttestations: data?.productionComponentAttestations ?? {},
    productionResilienceDrills: data?.productionResilienceDrills ?? {},
    institutionConfigurations: data?.institutionConfigurations ?? {},
    sourceEtlRuns: data?.sourceEtlRuns ?? {},
    operationalReadiness: data?.operationalReadiness ?? {},
    independentAssuranceTests: data?.independentAssuranceTests ?? {},
    governanceSignoffs: data?.governanceSignoffs ?? {},
    liveIntegrations: data?.liveIntegrations ?? {},
    liveIntegrationConformance: data?.liveIntegrationConformance ?? {},
    tenantPlans: data?.tenantPlans ?? {},
    environmentPromotions: data?.environmentPromotions ?? {},
    portabilityImports: data?.portabilityImports ?? {},
    tenantCommunications: data?.tenantCommunications ?? {},
    riskPricingMatrices: data?.riskPricingMatrices ?? {},
    productAddons: data?.productAddons ?? {},
    tenantProductSubscriptions: data?.tenantProductSubscriptions ?? {},
    productAddonRequests: data?.productAddonRequests ?? {},
    productAdminGrants: data?.productAdminGrants ?? {},
    tenantCustomProducts: data?.tenantCustomProducts ?? {},
    platformProductTemplates: data?.platformProductTemplates ?? {},
    productJourneyConformanceCampaigns: data?.productJourneyConformanceCampaigns ?? {},
    journeyWorkspaceDrafts: data?.journeyWorkspaceDrafts ?? {},
    composedJourneyLifecycles: data?.composedJourneyLifecycles ?? {},
    composedJourneyTransitionRequests: data?.composedJourneyTransitionRequests ?? {},
    composedJourneyEscalations: data?.composedJourneyEscalations ?? {},
    specialistJourneyConfigurationRequests: data?.specialistJourneyConfigurationRequests ?? {},
    specialistJourneyConfigurations: data?.specialistJourneyConfigurations ?? {},
    specialistJourneyCases: data?.specialistJourneyCases ?? {},
    specialistJourneyActionRequests: data?.specialistJourneyActionRequests ?? {},
    specialistJourneyExceptions: data?.specialistJourneyExceptions ?? {},
    specialistJourneyEscalations: data?.specialistJourneyEscalations ?? {},
    specialisedJourneys: data?.specialisedJourneys ?? {},
    tradeJourneyPacks: data?.tradeJourneyPacks ?? {},
    tradeParties: data?.tradeParties ?? {},
    tradeAssets: data?.tradeAssets ?? {},
    tradeTransactions: data?.tradeTransactions ?? {},
    profitabilityParameters: data?.profitabilityParameters ?? {},
    physicalOriginalCustody: data?.physicalOriginalCustody ?? {},
    collateralRecords: data?.collateralRecords ?? {},
    multipartySignings: data?.multipartySignings ?? {},
    disbursementTranches: data?.disbursementTranches ?? {},
    postDisbursementFollowups: data?.postDisbursementFollowups ?? {},
    servicingChanges: data?.servicingChanges ?? {},
    servicingDocuments: data?.servicingDocuments ?? {},
    collectionStrategies: data?.collectionStrategies ?? {},
    collectionTreatmentPlans: data?.collectionTreatmentPlans ?? {},
    collectionPortfolioAllocations: data?.collectionPortfolioAllocations ?? {},
    collectionAgencySettlements: data?.collectionAgencySettlements ?? {},
    recoveryRepossessions: data?.recoveryRepossessions ?? {},
    recoveryAuctions: data?.recoveryAuctions ?? {},
    recoveryAccounting: data?.recoveryAccounting ?? {},
    closureReleases: data?.closureReleases ?? {},
    closureSlaAssessments: data?.closureSlaAssessments ?? {},
    lspIncidents: data?.lspIncidents ?? {},
    servicingPortfolioTransfers: data?.servicingPortfolioTransfers ?? {},
    partnerOversightAssessments: data?.partnerOversightAssessments ?? {},
    grievanceRcaCapa: data?.grievanceRcaCapa ?? {},
    assistedComplaints: data?.assistedComplaints ?? {},
    ombudsmanAwards: data?.ombudsmanAwards ?? {},
    regulatoryReturns: data?.regulatoryReturns ?? {},
    governedConnectors: data?.governedConnectors ?? {},
    dataProducts: data?.dataProducts ?? {},
    masterReferenceVersions: data?.masterReferenceVersions ?? {},
    complaints: data?.complaints ?? {},
    incidents: data?.incidents ?? {},
    fraudCases: data?.fraudCases ?? {},
    loanApplications: data?.loanApplications ?? {},
    loanAccounts: data?.loanAccounts ?? {},
    legalRecoveryCases: data?.legalRecoveryCases ?? {},
    securityInterests: data?.securityInterests ?? {},
    accessRequests: data?.accessRequests ?? {},
    correctionRequests: data?.correctionRequests ?? {},
    fiuReports: data?.fiuReports ?? {},
    documentVault: data?.documentVault ?? {},
    communications: data?.communications ?? {},
    communicationDeliveries: data?.communicationDeliveries ?? {},
    providerCallbackDeliveries: data?.providerCallbackDeliveries ?? {},
    signedFileSchemaProfiles: data?.signedFileSchemaProfiles ?? {},
    signedFileEnvelopes: data?.signedFileEnvelopes ?? {},
    signedFileTransports: data?.signedFileTransports ?? {},
    businessAdapters: data?.businessAdapters ?? {},
    businessAdapterRequests: data?.businessAdapterRequests ?? {},
    paymentRails: data?.paymentRails ?? {},
    paymentReconciliations: data?.paymentReconciliations ?? {},
    bankReconciliations: data?.bankReconciliations ?? {},
    paymentSuspenseReceipts: data?.paymentSuspenseReceipts ?? {},
    paymentSettlementFiles: data?.paymentSettlementFiles ?? {},
    reconciliationBreakAssignments: data?.reconciliationBreakAssignments ?? {},
    accountingPostingRuns: data?.accountingPostingRuns ?? {},
    glDeliveries: data?.glDeliveries ?? {},
    glReconciliations: data?.glReconciliations ?? {},
    coreBankingDeliveries: data?.coreBankingDeliveries ?? {},
    financeExceptions: data?.financeExceptions ?? {},
    financeCloseSchedules: data?.financeCloseSchedules ?? {},
    financeOperationalRuns: data?.financeOperationalRuns ?? {},
    financePeriodClosures: data?.financePeriodClosures ?? {},
    reconciliationCertifications: data?.reconciliationCertifications ?? {},
    businessDateClosures: data?.businessDateClosures ?? {},
    eclProvisions: data?.eclProvisions ?? {},
    eclParameterSets: data?.eclParameterSets ?? {},
    iracIncomeAdjustments: data?.iracIncomeAdjustments ?? {},
    taxWithholdings: data?.taxWithholdings ?? {},
    gstInvoices: data?.gstInvoices ?? {},
    gstCreditNotes: data?.gstCreditNotes ?? {},
    tdsCertificates: data?.tdsCertificates ?? {},
    iracMemorandumInterest: data?.iracMemorandumInterest ?? {},
    iracRecoveryRecognitions: data?.iracRecoveryRecognitions ?? {},
    eirAmortizations: data?.eirAmortizations ?? {},
    fundingFacilities: data?.fundingFacilities ?? {},
    loanFundingAllocations: data?.loanFundingAllocations ?? {},
    taxFilings: data?.taxFilings ?? {},
    cicSubmissionBatches: data?.cicSubmissionBatches ?? {},
    cicCorrectionRequests: data?.cicCorrectionRequests ?? {},
    ckycrrSubmissions: data?.ckycrrSubmissions ?? {},
    ckycrrDownloads: data?.ckycrrDownloads ?? {},
    workflowTasks: normalizeWorkflowTaskStore(data?.workflowTasks),
    modelRegistry: normalizeModelRegistryState(data?.modelRegistry),
    aiAgentPlatform: normalizeAiAgentPlatformState(data?.aiAgentPlatform),
    aiHandoffRequests: data?.aiHandoffRequests ?? {},
    marketplaceOffers: data?.marketplaceOffers ?? {},
    users: normalizeTenantUsers(data?.users),
    accessReviews: normalizeAccessReviews(data?.accessReviews),
    saasPrincipals: data?.saasPrincipals ?? {},
    saasRoleRequests: data?.saasRoleRequests ?? {},
    saasRoleGrants: data?.saasRoleGrants ?? {},
    tenantFeatureStaffingConfigs: data?.tenantFeatureStaffingConfigs ?? {},
    staffingEscalations: data?.staffingEscalations ?? {},
    featureStaffingRequests: data?.featureStaffingRequests ?? {},
    staffingEscalationClosureRequests: data?.staffingEscalationClosureRequests ?? {},
    tenantOwnership: data?.tenantOwnership ?? {},
    bootstrapTransitionRequests: data?.bootstrapTransitionRequests ?? {},
    ownershipTransferRequests: data?.ownershipTransferRequests ?? {},
    emergencyAccessRequests: data?.emergencyAccessRequests ?? {},
    emergencyAccessGrants: data?.emergencyAccessGrants ?? {},
    accessActivityEvents: Array.isArray(data?.accessActivityEvents) ? data.accessActivityEvents : [],
    events: Array.isArray(data?.events) ? data.events : []
  };
}

const MOCK_CKYC_PRESEED = {
  "99999999999999": {
    ckycNumber: "99999999999999",
    fullName: "Aaditya Patel",
    dateOfBirth: "1990-01-01",
    gender: "M",
    idType: "pan",
    idNumber: "ABCDE1234F",
    contact: {
      mobile: "+91-9999999999",
      email: "aaditya@example.in"
    },
    address: {
      line1: "123 Residency Road",
      city: "Bengaluru",
      state: "Karnataka",
      country: "IN"
    }
  }
};

// Exported so other storage drivers (e.g. postgres-store.js) can normalize a
// state object assembled from a different backing store into the exact same
// defaulted shape this module produces from a JSON file — every pure
// function elsewhere in this file (registerTenant, grantBreakGlass, ...)
// depends on that shape being fully defaulted, not on *how* it was loaded.
export function normalizeState(state) {
  const tenants = {};
  for (const [tenantId, data] of Object.entries(state?.tenants ?? {})) {
    tenants[tenantId] = normalizeTenantData(data);
  }
  return {
    version: STATE_VERSION,
    controlPlane: {
      tenants: state?.controlPlane?.tenants ?? {},
      organisationSignups: state?.controlPlane?.organisationSignups ?? {},
      organisationSignupRateLimits: state?.controlPlane?.organisationSignupRateLimits ?? {},
      subProcessors: state?.controlPlane?.subProcessors ?? {},
      breakGlassGrants: state?.controlPlane?.breakGlassGrants ?? {},
      platformUsers: normalizePlatformUsers(state?.controlPlane?.platformUsers),
      sessions: normalizeSessions(state?.controlPlane?.sessions),
      loginAttempts: normalizeLoginAttempts(state?.controlPlane?.loginAttempts),
      federationLoginChallenges: state?.controlPlane?.federationLoginChallenges ?? {},
      platformEvents: Array.isArray(state?.controlPlane?.platformEvents) ? state.controlPlane.platformEvents : [],
      ckycRegistry: state?.controlPlane?.ckycRegistry ?? { ...MOCK_CKYC_PRESEED }
    },
    tenants
  };
}

export function createEmptyState() {
  return {
    version: STATE_VERSION,
    controlPlane: {
      tenants: {},
      organisationSignups: {},
      organisationSignupRateLimits: {},
      subProcessors: {},
      breakGlassGrants: {},
      platformUsers: {},
      sessions: {},
      loginAttempts: {},
      federationLoginChallenges: {},
      platformEvents: [],
      ckycRegistry: { ...MOCK_CKYC_PRESEED }
    },
    tenants: {}
  };
}

// --- Platform-level audit chain (control-plane actions) --------------------

// Mirrors the per-tenant audit spine but scoped to the fixed id "platform", so
// tenant onboarding/status changes, platform user administration, break-glass
// grants, and sub-processor registration are themselves tamper-evidently
// logged, not just the tenant-scoped actions they trigger.
const PLATFORM_AUDIT_SCOPE = "platform";

export function appendPlatformEvent(state, event, { actor = null, actorType = AUDIT_ACTOR_TYPES.PLATFORM_STAFF } = {}, now = new Date()) {
  const withEvent = [...(state.controlPlane.platformEvents ?? []), { ...event, at: event.at ?? now.toISOString() }];
  const stamped = stampAuditEvents(withEvent, { actor, actorType });
  const sealed = sealAuditChain(stamped, PLATFORM_AUDIT_SCOPE, { now });
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      platformEvents: sealed
    }
  };
}

export function buildPlatformAuditEvidencePack(state, { now = new Date(), filters } = {}) {
  return buildAuditEvidencePack(state.controlPlane.platformEvents ?? [], PLATFORM_AUDIT_SCOPE, { now, filters });
}

// --- Concurrency safety ------------------------------------------------------

// The whole platform (every tenant's data plane plus the control plane) lives
// in one state.json, loaded fully and rewritten fully on every save. Without
// serialization, two concurrent requests can both load the same snapshot and
// the second save silently overwrites the first (a lost update). withStateLock
// serializes a request's entire load-modify-save span per dataDir via a
// promise chain, so requests against the same dataDir queue instead of racing.
// This does not add real concurrency (that needs per-record storage), but it
// makes the single-file store correct under concurrent requests.
const stateLocks = new Map();

// lockKey exists so the postgres driver can serialize per-tenant instead of
// platform-wide (see postgres-store.js); the file driver ignores it and
// keeps locking by dataDir alone — every save here rewrites the whole file
// regardless of which tenant changed, so there is no finer granularity a
// lock key could actually buy this driver.
export function withStateLock(dataDir, _lockKey, fn) {
  const key = dataDir ?? "";
  const prior = stateLocks.get(key) ?? Promise.resolve();
  const result = prior.then(fn, fn);
  stateLocks.set(key, result.then(() => {}, () => {}));
  return result;
}

export async function loadState(dataDir = resolveDataDir()) {
  const path = statePath(dataDir);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(decryptStateTenants(parsed));
  } catch (error) {
    if (error.code === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

export async function saveState(state, dataDir = resolveDataDir()) {
  const path = statePath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const persisted = encryptStateTenants(normalizeState(state));
  await writeFile(tmpPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
}

// Transparently encrypt each tenant's data-plane partition under its own
// per-tenant key before the state is written to disk (no-op when no master key
// is configured, so dev/test behavior is unchanged). The control plane stays
// plaintext because it is cross-tenant by construction (tenant registry,
// sessions) and cannot be scoped to a single tenant key.
function encryptStateTenants(state) {
  const activeKey = getActiveMasterKey();
  if (!activeKey) return state;
  const tenants = {};
  for (const [tenantId, data] of Object.entries(state.tenants ?? {})) {
    tenants[tenantId] = isEncryptedEnvelope(data)
      ? data
      : encryptTenantData(activeKey.key, tenantId, data, activeKey.keyId);
  }
  return { ...state, tenants };
}

function decryptStateTenants(parsed) {
  const tenants = parsed?.tenants ?? {};
  const hasEnvelope = Object.values(tenants).some(isEncryptedEnvelope);
  if (!hasEnvelope) return parsed;
  const decrypted = {};
  for (const [tenantId, data] of Object.entries(tenants)) {
    if (!isEncryptedEnvelope(data)) {
      decrypted[tenantId] = data;
      continue;
    }
    const key = getMasterKeyById(data.kid);
    if (!key) throw new Error("State on disk is encrypted but no master-key provider is configured.");
    decrypted[tenantId] = decryptTenantData(key.key, tenantId, data);
  }
  return { ...parsed, tenants: decrypted };
}

// --- Tenant control plane -------------------------------------------------

export function hashApiKey(apiKey) {
  return createHash("sha256").update(String(apiKey)).digest("hex");
}

export function generateApiKey(isSandbox = false) {
  const prefix = isSandbox ? "lsk_test" : "lsk";
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

export function publicServiceCredential(record) {
  if (!record) return null;
  const { secretHash, ...publicRecord } = record;
  return publicRecord;
}

export function createServiceCredential(record, input = {}, secret, now = new Date()) {
  if (!input.credentialId || !/^[a-zA-Z0-9_-]{3,64}$/.test(input.credentialId)) throw new Error("credentialId must be 3-64 safe characters.");
  if (!input.name) throw new Error("Service credential name is required.");
  const scopes = [...new Set(Array.isArray(input.scopes) ? input.scopes : [])];
  if (scopes.length === 0 || scopes.some((scope) => scope !== "*" && !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(scope))) throw new Error("Service credential requires valid scopes.");
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && (Number.isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= now.getTime())) throw new Error("Service credential expiry must be in the future.");
  if (record.serviceCredentials?.[input.credentialId]) throw new Error("Service credential already exists.");
  const credential = { credentialId: input.credentialId, name: input.name, secretHash: hashApiKey(secret), scopes, status: "active", expiresAt, createdAt: now.toISOString(), createdBy: input.createdBy ?? null, lastRotatedAt: now.toISOString(), lastRotatedBy: input.createdBy ?? null };
  return { tenant: { ...record, serviceCredentials: { ...(record.serviceCredentials ?? {}), [credential.credentialId]: credential }, updatedAt: now.toISOString() }, credential: publicServiceCredential(credential) };
}

export function revokeServiceCredential(record, credentialId, input = {}, now = new Date()) {
  const credential = record.serviceCredentials?.[credentialId];
  if (!credential || credential.status !== "active") throw new Error("Active service credential not found.");
  const revoked = { ...credential, status: "revoked", revokedAt: now.toISOString(), revokedBy: input.revokedBy ?? null, revocationReason: input.reason ?? null };
  return {
    tenant: {
      ...record,
      ...(credentialId === "svc_default" ? { apiKeyHash: null } : {}),
      serviceCredentials: { ...record.serviceCredentials, [credentialId]: revoked },
      updatedAt: now.toISOString()
    },
    credential: publicServiceCredential(revoked)
  };
}

export function rotateServiceCredential(record, credentialId, secret, input = {}, now = new Date()) {
  const credential = record.serviceCredentials?.[credentialId];
  if (!credential || credential.status !== "active") throw new Error("Active service credential not found.");
  const rotated = { ...credential, secretHash: hashApiKey(secret), lastRotatedAt: now.toISOString(), lastRotatedBy: input.rotatedBy ?? null };
  return {
    tenant: {
      ...record,
      ...(credentialId === "svc_default" ? { apiKeyHash: rotated.secretHash } : {}),
      serviceCredentials: { ...record.serviceCredentials, [credentialId]: rotated },
      updatedAt: now.toISOString()
    },
    credential: publicServiceCredential(rotated)
  };
}

export function containServiceCredentialCompromise(record, input = {}, now = new Date()) {
  if (!input.incidentId) throw new Error("Compromise containment requires an incidentId.");
  if (!input.reason || String(input.reason).trim().length < 8) throw new Error("Compromise containment requires a specific reason.");
  const credentials = record.serviceCredentials ?? {};
  const requestedIds = input.allActive === true
    ? Object.values(credentials).filter((credential) => credential.status === "active").map((credential) => credential.credentialId)
    : [...new Set(Array.isArray(input.credentialIds) ? input.credentialIds.map(String) : [])];
  if (requestedIds.length === 0) throw new Error("At least one active service credential must be selected.");
  const unavailable = requestedIds.filter((credentialId) => credentials[credentialId]?.status !== "active");
  if (unavailable.length > 0) throw new Error(`Active service credential not found: ${unavailable.join(", ")}.`);

  const compromisedAt = now.toISOString();
  const nextCredentials = { ...credentials };
  for (const credentialId of requestedIds) {
    nextCredentials[credentialId] = {
      ...credentials[credentialId],
      status: "revoked",
      revokedAt: compromisedAt,
      revokedBy: input.actor ?? null,
      revocationReason: input.reason,
      compromiseIncidentId: input.incidentId,
      compromisedAt,
      compromisedBy: input.actor ?? null
    };
  }
  return {
    tenant: {
      ...record,
      ...(requestedIds.includes("svc_default") ? { apiKeyHash: null } : {}),
      serviceCredentials: nextCredentials,
      updatedAt: compromisedAt
    },
    credentials: requestedIds.map((credentialId) => publicServiceCredential(nextCredentials[credentialId]))
  };
}

function normalizeSelectionList(value, allowed, defaults) {
  const raw = Array.isArray(value) ? value : defaults;
  return [...new Set(raw.filter((item) => allowed.has(item)))];
}

function normalizeStringList(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String))];
}

export function normalizeTenantOnboarding(input = {}, existing = {}, now = new Date()) {
  const enabledModules = normalizeSelectionList(
    input.enabledModules ?? input.modules ?? existing.enabledModules,
    MODULE_IDS,
    DEFAULT_ONBOARDING_MODULES
  );
  const enabledFlows = normalizeSelectionList(
    input.enabledFlows ?? input.flows ?? existing.enabledFlows,
    FLOW_IDS,
    DEFAULT_ONBOARDING_FLOWS
  );
  const status = ONBOARDING_STATUSES.has(input.status) ? input.status : existing.status ?? "configured";
  return {
    status,
    launchMode: input.launchMode ?? existing.launchMode ?? "pilot",
    primaryRegulatedEntityId:
      input.primaryRegulatedEntityId ?? existing.primaryRegulatedEntityId ?? null,
    productIds: normalizeStringList(input.productIds ?? existing.productIds),
    enabledModules,
    enabledFlows,
    disabledModules: TENANT_ONBOARDING_MODULES
      .map((module) => module.id)
      .filter((moduleId) => !enabledModules.includes(moduleId)),
    disabledFlows: TENANT_ONBOARDING_FLOWS
      .map((flow) => flow.id)
      .filter((flowId) => !enabledFlows.includes(flowId)),
    checklist: {
      ...(existing.checklist ?? {}),
      ...(input.checklist ?? {})
    },
    notes: input.notes ?? existing.notes ?? null,
    createdAt: existing.createdAt ?? input.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function computeTenantOnboardingReadiness(record, tenantData) {
  const onboarding = normalizeTenantOnboarding(record?.onboarding ?? {});
  const regulatedEntities = Object.values(tenantData?.regulatedEntities ?? {});
  const productPolicies = Object.values(tenantData?.productPolicies ?? {});
  const users = Object.values(tenantData?.users ?? {});
  const findings = [];
  const checklist = {
    tenantActive: record?.status === "active",
    ownerUser: users.some((user) => (user.adminRoles ?? []).includes("tenant_admin")),
    regulatedEntity: regulatedEntities.some((entity) => entity.status === "active"),
    productPolicy: productPolicies.some((product) => product.status === "active"),
    modulesSelected: onboarding.enabledModules.length > 0,
    flowsSelected: onboarding.enabledFlows.length > 0,
    serviceCredential: Boolean(record?.apiKeyHash),
    accessGovernance:
      users.some((user) => (user.adminRoles ?? []).includes("security_admin")) ||
      users.some((user) => (user.adminRoles ?? []).includes("auditor"))
  };

  if (!checklist.tenantActive) {
    findings.push({ code: "tenant_not_active", severity: "error", message: "Tenant status must be active before launch." });
  }
  if (!checklist.ownerUser) {
    findings.push({ code: "owner_user_missing", severity: "error", message: "Create at least one tenant administrator." });
  }
  if (!checklist.regulatedEntity) {
    findings.push({ code: "regulated_entity_missing", severity: "error", message: "Seed an active regulated entity profile." });
  }
  if (!checklist.productPolicy) {
    findings.push({ code: "product_policy_missing", severity: "error", message: "Seed at least one active product policy." });
  }
  if (!checklist.modulesSelected) {
    findings.push({ code: "modules_missing", severity: "error", message: "Select at least one enabled module." });
  }
  if (!checklist.flowsSelected) {
    findings.push({ code: "flows_missing", severity: "error", message: "Select at least one enabled operating flow." });
  }
  if (!checklist.serviceCredential) {
    findings.push({ code: "service_key_missing", severity: "warning", message: "No active tenant service credential is present." });
  }
  if (!checklist.accessGovernance) {
    findings.push({ code: "governance_roles_missing", severity: "warning", message: "Assign security or auditor responsibility before production launch." });
  }

  const hasErrors = findings.some((finding) => finding.severity === "error");
  const hasWarnings = findings.some((finding) => finding.severity === "warning");
  return {
    status: hasErrors ? "blocked" : hasWarnings ? "attention" : "ready",
    checklist,
    findings,
    onboarding,
    counts: {
      regulatedEntities: regulatedEntities.length,
      productPolicies: productPolicies.length,
      users: users.length
    }
  };
}

export function registerTenant(state, tenant, now = new Date()) {
  const { tenantId } = tenant;
  if (!tenantId) {
    throw new Error("registerTenant requires a tenantId.");
  }
  const existing = state.controlPlane.tenants[tenantId];
  const record = {
    tenantId,
    name: tenant.name ?? existing?.name ?? tenantId,
    apiKeyHash: tenant.apiKey ? hashApiKey(tenant.apiKey) : existing?.apiKeyHash ?? null,
    isolationTier: tenant.isolationTier ?? existing?.isolationTier ?? "pooled",
    status: tenant.status ?? existing?.status ?? "active",
    isSandbox: tenant.isSandbox ?? existing?.isSandbox ?? false,
    syntheticOnly: tenant.syntheticOnly ?? existing?.syntheticOnly ?? false,
    demoProfile: tenant.demoProfile ?? existing?.demoProfile ?? null,
    parentTenantId: tenant.parentTenantId ?? existing?.parentTenantId ?? null,
    sandboxName: tenant.sandboxName ?? existing?.sandboxName ?? null,
    organisationSignupId: tenant.organisationSignupId ?? existing?.organisationSignupId ?? null,
    deploymentStage: tenant.deploymentStage ?? existing?.deploymentStage ?? null,
    activationGates: tenant.activationGates ?? existing?.activationGates ?? {
      provisioning: null,
      roleCoverage: null,
      uat: null,
      handover: null
    },
    onboarding: normalizeTenantOnboarding(tenant.onboarding ?? existing?.onboarding ?? {}, existing?.onboarding, now),
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
  record.serviceCredentials = existing?.serviceCredentials ?? (record.apiKeyHash ? { svc_default: { credentialId: "svc_default", name: "Default service credential", secretHash: record.apiKeyHash, scopes: ["*"], status: "active", expiresAt: null, createdAt: existing?.createdAt ?? now.toISOString(), createdBy: "tenant_provisioning", lastRotatedAt: now.toISOString(), lastRotatedBy: "tenant_provisioning" } } : {});
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      tenants: {
        ...state.controlPlane.tenants,
        [tenantId]: record
      }
    },
    tenants: {
      ...state.tenants,
      [tenantId]: state.tenants[tenantId] ?? createEmptyTenantData()
    }
  };
}

export function listTenants(state) {
  return Object.values(state.controlPlane.tenants).map(publicTenant);
}

export function listSandboxes(state, parentTenantId) {
  return Object.values(state.controlPlane.tenants)
    .filter((t) => t.isSandbox && t.parentTenantId === parentTenantId && t.status !== "offboarded")
    .map(publicTenant);
}

export function resetSandbox(state, sandboxId, preserveConfig = false) {
  const tenantData = state.tenants[sandboxId];
  if (!tenantData) {
    return state;
  }
  let newTenantData;
  if (preserveConfig) {
    newTenantData = {
      ...createEmptyTenantData(),
      regulatedEntities: tenantData.regulatedEntities ?? {},
      lendingServiceProviders: tenantData.lendingServiceProviders ?? {},
      digitalLendingApps: tenantData.digitalLendingApps ?? {},
      productPolicies: tenantData.productPolicies ?? {},
      recoveryAgents: tenantData.recoveryAgents ?? {},
      dlgArrangements: tenantData.dlgArrangements ?? {},
      coLendingArrangements: tenantData.coLendingArrangements ?? {},
      users: tenantData.users ?? {},
      accessReviews: tenantData.accessReviews ?? {},
      saasPrincipals: tenantData.saasPrincipals ?? {},
      saasRoleGrants: tenantData.saasRoleGrants ?? {},
      tenantFeatureStaffingConfigs: tenantData.tenantFeatureStaffingConfigs ?? {},
      staffingEscalations: tenantData.staffingEscalations ?? {},
      featureStaffingRequests: tenantData.featureStaffingRequests ?? {},
      staffingEscalationClosureRequests: tenantData.staffingEscalationClosureRequests ?? {},
      tenantOwnership: tenantData.tenantOwnership ?? {},
    };
  } else {
    newTenantData = createEmptyTenantData();
  }
  return {
    ...state,
    tenants: {
      ...state.tenants,
      [sandboxId]: newTenantData
    }
  };
}

export function deleteSandbox(state, sandboxId, now = new Date()) {
  const record = state.controlPlane.tenants[sandboxId];
  if (!record || !record.isSandbox) {
    return state;
  }
  const nextTenants = { ...state.tenants };
  delete nextTenants[sandboxId];
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      tenants: {
        ...state.controlPlane.tenants,
        [sandboxId]: {
          ...record,
          status: "offboarded",
          updatedAt: now.toISOString()
        }
      }
    },
    tenants: nextTenants
  };
}

export function publicTenant(record) {
  if (!record) {
    return null;
  }
  const { apiKeyHash, ...rest } = record;
  return { ...rest, serviceCredentials: Object.fromEntries(Object.entries(rest.serviceCredentials ?? {}).map(([id, credential]) => [id, publicServiceCredential(credential)])) };
}

export function resolveTenantByApiKey(state, apiKey) {
  if (!apiKey) {
    return null;
  }
  const hash = hashApiKey(apiKey);
  return resolveTenantServiceCredential(state, apiKey)?.tenant ?? null;
}

export function resolveTenantServiceCredential(state, apiKey, now = new Date()) {
  if (!apiKey) return null;
  const hash = hashApiKey(apiKey);
  for (const tenant of Object.values(state.controlPlane.tenants)) {
    if (tenant.status !== "active") continue;
    for (const credential of Object.values(tenant.serviceCredentials ?? {})) {
      if (credential.secretHash === hash && credential.status === "active" && (!credential.expiresAt || new Date(credential.expiresAt).getTime() > now.getTime())) return { tenant, credential: publicServiceCredential(credential) };
    }
  }
  return null;
}

// --- Sub-processor register (control plane, disclosed to every tenant) -----

// LoanOS is itself an IT service provider inside each RE's regulatory perimeter,
// so every downstream sub-processor it uses must be disclosed to tenant REs
// (RBI IT-Outsourcing MD 2023; DPDP data-processor duties). The register lives
// in the control plane — it is platform-wide, not tenant-scoped — and read
// access is exposed to every authenticated tenant as a standing disclosure.

const SUB_PROCESSOR_STATUSES = new Set(["active", "retired"]);

export function validateSubProcessor(input) {
  const findings = [];
  if (!input?.subProcessorId) {
    findings.push({ code: "sub_processor_id_required", message: "A subProcessorId is required." });
  }
  if (!input?.name) {
    findings.push({ code: "sub_processor_name_required", message: "A sub-processor name is required." });
  }
  if (!input?.purpose) {
    findings.push({ code: "sub_processor_purpose_required", message: "A processing purpose is required." });
  }
  if (!input?.dataResidencyCountry) {
    findings.push({
      code: "sub_processor_residency_required",
      message: "A data-residency country is required to disclose cross-border processing."
    });
  }
  // RBI outsourcing requires a governing contract with every service provider.
  if (input?.dpaInPlace !== true) {
    findings.push({
      code: "sub_processor_dpa_required",
      message: "A data-processing agreement must be in place before a sub-processor is registered."
    });
  }
  if (input?.status && !SUB_PROCESSOR_STATUSES.has(input.status)) {
    findings.push({
      code: "sub_processor_status_invalid",
      message: `status must be one of: ${[...SUB_PROCESSOR_STATUSES].join(", ")}.`
    });
  }
  return findings;
}

export function publicSubProcessor(record) {
  if (!record) {
    return null;
  }
  return {
    ...record,
    // A disclosed, derived fact so tenant REs can see cross-border processing
    // without reasoning about country codes themselves.
    crossBorder: record.dataResidencyCountry !== "IN"
  };
}

export function registerSubProcessor(state, input, now = new Date()) {
  const { subProcessorId } = input;
  const existing = state.controlPlane.subProcessors?.[subProcessorId] ?? null;
  const record = {
    subProcessorId,
    name: input.name ?? existing?.name ?? subProcessorId,
    purpose: input.purpose ?? existing?.purpose ?? null,
    dataCategories: Array.isArray(input.dataCategories)
      ? input.dataCategories
      : existing?.dataCategories ?? [],
    dataResidencyCountry: input.dataResidencyCountry ?? existing?.dataResidencyCountry ?? null,
    contractReference: input.contractReference ?? existing?.contractReference ?? null,
    dpaInPlace: input.dpaInPlace ?? existing?.dpaInPlace ?? false,
    status: input.status ?? existing?.status ?? "active",
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString()
  };
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      subProcessors: {
        ...state.controlPlane.subProcessors,
        [subProcessorId]: record
      }
    }
  };
}

export function listSubProcessors(state) {
  return Object.values(state.controlPlane.subProcessors ?? {}).map(publicSubProcessor);
}

// --- Platform-staff break-glass access -------------------------------------

// Cross-tenant access is impossible by construction, but platform staff may need
// emergency access to one tenant's data plane (incident response, recovery). A
// break-glass grant is minted by the platform admin, scoped to a single tenant,
// time-boxed, and carries a reason. Every request made under it is sealed into
// that tenant's audit chain, so the tenant can see exactly who reached in, when,
// and why — access is transparent to the tenant, never silent.

const DEFAULT_BREAK_GLASS_TTL_MINUTES = 60;

export function generateBreakGlassKey() {
  return `bgk_${randomBytes(24).toString("hex")}`;
}

export function grantBreakGlass(state, input, now = new Date()) {
  const { tenantId } = input;
  if (!tenantId || !state.controlPlane.tenants[tenantId]) {
    throw new Error("grantBreakGlass requires an existing tenantId.");
  }
  const grantId = input.grantId ?? `bg_${randomBytes(8).toString("hex")}`;
  const ttlMinutes = Number.isFinite(input.ttlMinutes) ? input.ttlMinutes : DEFAULT_BREAK_GLASS_TTL_MINUTES;
  const record = {
    grantId,
    tenantId,
    staffId: input.staffId,
    reason: input.reason,
    credentialHash: hashApiKey(input.credential),
    status: "active",
    createdBy: input.createdBy ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()
  };
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      breakGlassGrants: {
        ...state.controlPlane.breakGlassGrants,
        [grantId]: record
      }
    }
  };
}

export function breakGlassEffectiveStatus(record, now = new Date()) {
  if (record.status !== "active") {
    return record.status;
  }
  return new Date(record.expiresAt).getTime() < now.getTime() ? "expired" : "active";
}

export function publicBreakGlassGrant(record, now = new Date()) {
  if (!record) {
    return null;
  }
  const { credentialHash, ...rest } = record;
  return { ...rest, effectiveStatus: breakGlassEffectiveStatus(record, now) };
}

export function resolveBreakGlass(state, credential, now = new Date()) {
  if (!credential) {
    return null;
  }
  const hash = hashApiKey(credential);
  const grant = Object.values(state.controlPlane.breakGlassGrants ?? {}).find(
    (record) => record.credentialHash === hash && breakGlassEffectiveStatus(record, now) === "active"
  );
  if (!grant) {
    return null;
  }
  const tenant = state.controlPlane.tenants[grant.tenantId];
  if (!tenant || tenant.status !== "active") {
    return null;
  }
  return { grant, tenant };
}

export function revokeBreakGlass(state, grantId, now = new Date()) {
  const record = state.controlPlane.breakGlassGrants?.[grantId];
  if (!record) {
    return null;
  }
  return {
    ...state,
    controlPlane: {
      ...state.controlPlane,
      breakGlassGrants: {
        ...state.controlPlane.breakGlassGrants,
        [grantId]: { ...record, status: "revoked", revokedAt: now.toISOString() }
      }
    }
  };
}

export function listBreakGlassGrants(state, tenantId, now = new Date()) {
  return Object.values(state.controlPlane.breakGlassGrants ?? {})
    .filter((record) => !tenantId || record.tenantId === tenantId)
    .map((record) => publicBreakGlassGrant(record, now));
}

// --- Tenant-scoped data accessors (the isolation seam) --------------------

export function getTenantData(state, tenantId) {
  return state.tenants[tenantId] ?? null;
}

export function setTenantData(state, tenantId, tenantData) {
  return {
    ...state,
    tenants: {
      ...state.tenants,
      [tenantId]: tenantData
    }
  };
}

// --- Targeted (v3) accessors ------------------------------------------------
//
// The postgres driver fetches/persists exactly one tenant's data-plane
// document per request instead of every tenant's (see postgres-store.js).
// The file driver has no way to do a partial read/write of a single JSON
// file — every call here still round-trips the whole file — but exposing
// the same four functions means server.js's route() dispatcher doesn't need
// to know or care which driver is active.

export async function loadControlPlaneOnly(dataDir) {
  const state = await loadState(dataDir);
  return { ...state, tenants: {} };
}

export async function loadTenantDataOnly(dataDir, tenantId) {
  const state = await loadState(dataDir);
  return getTenantData(state, tenantId) ?? createEmptyTenantData();
}

export async function saveTenantDataOnly(dataDir, tenantId, tenantData) {
  const state = await loadState(dataDir);
  await saveState(setTenantData(state, tenantId, tenantData), dataDir);
}

export async function saveControlPlaneOnly(dataDir, controlPlaneState) {
  const state = await loadState(dataDir);
  await saveState({ ...state, controlPlane: controlPlaneState.controlPlane }, dataDir);
}

// loadStateFn/saveStateFn default to this module's own file-backed
// loadState/saveState, so every existing caller (and every test) is
// completely unaffected. A different storage driver (postgres-store.js)
// injects its own load/save so this one seeding implementation — the "dev"
// tenant's demo data in particular — is not duplicated per driver.
export async function ensureBootstrapTenants(
  dataDir,
  bootstrapTenants = [],
  { loadStateFn = loadState, saveStateFn = saveState } = {}
) {
  let state = await loadStateFn(dataDir);
  let changed = false;

  // Bootstrap platform administrator user if it doesn't exist
  if (!state.controlPlane.platformUsers || Object.keys(state.controlPlane.platformUsers).length === 0) {
    const platformPassword = process.env.LOANOS_PLATFORM_ADMIN_PASSWORD || "platform-admin-password";
    const result = upsertPlatformUser(state.controlPlane.platformUsers ?? {}, {
      userId: "platform_admin_1",
      email: "admin@platform.local",
      displayName: "Platform Administrator",
      password: platformPassword,
      mustChangePassword: false,
      mfaRequired: false,
      roles: ["platform_admin", "tenant_provisioner", "security_admin", "auditor"],
      country: "IN"
    });
    if (result.findings.length === 0) {
      state = {
        ...state,
        controlPlane: {
          ...state.controlPlane,
          platformUsers: result.users
        }
      };
      changed = true;
    }
  }

  if (!bootstrapTenants.length) {
    if (changed) {
      await saveStateFn(state, dataDir);
    }
    return;
  }
  for (const tenant of bootstrapTenants) {
    const existing = state.controlPlane.tenants[tenant.tenantId];
    // Keep a bootstrap tenant idempotent, but (re)bind its api key each start so
    // a fresh local run always has working credentials.
    const bootstrapApiKeyHash = tenant.apiKey ? hashApiKey(tenant.apiKey) : existing?.apiKeyHash;
    if (
      !existing ||
      existing.apiKeyHash !== bootstrapApiKeyHash ||
      (tenant.isSandbox !== undefined && existing.isSandbox !== tenant.isSandbox) ||
      (tenant.syntheticOnly !== undefined && existing.syntheticOnly !== tenant.syntheticOnly) ||
      (tenant.demoProfile !== undefined && existing.demoProfile !== tenant.demoProfile)
    ) {
      state = registerTenant(state, tenant);
      changed = true;
    }

    if (tenant.tenantId === "dev" && state.tenants["dev"]) {
      const devData = state.tenants["dev"];
      if (!devData.users || Object.keys(devData.users).length === 0) {
        const password = process.env.LOANOS_DEV_ADMIN_PASSWORD ?? "dev-admin-password";
        let users = { ...devData.users };
        
        // 1. Tenant Admin
        users = upsertTenantUser(users, {
          userId: "tenant_admin_1",
          email: "admin@dev.local",
          displayName: "Dev Tenant Admin",
          password,
          adminRoles: ["tenant_admin", "user_admin", "security_admin", "auditor"],
          roles: ["workflow_admin"],
          queues: ["*"],
          canAssignQueues: ["*"],
          country: "IN"
        }).users;

        // 2. Credit Maker
        users = upsertTenantUser(users, {
          userId: "credit_maker_1",
          email: "credit-maker-1@dev.local",
          displayName: "Credit Maker",
          password,
          roles: ["credit_officer"],
          queues: ["credit_ops"],
          country: "IN"
        }).users;

        // 3. Credit Checker
        users = upsertTenantUser(users, {
          userId: "credit_checker_1",
          email: "credit-checker-1@dev.local",
          displayName: "Credit Checker",
          password,
          roles: ["credit_checker"],
          queues: ["credit_checker"],
          country: "IN"
        }).users;

        // 4. Credit Lead
        users = upsertTenantUser(users, {
          userId: "credit_lead_1",
          email: "credit-lead-1@dev.local",
          displayName: "Credit Lead",
          password,
          roles: ["workflow_admin"],
          queues: ["*"],
          canAssignQueues: ["credit_checker"],
          country: "IN"
        }).users;

        // 5. Credit Human Reviewer
        users = upsertTenantUser(users, {
          userId: "credit_reviewer_1",
          email: "credit-reviewer-1@dev.local",
          displayName: "Credit Human Reviewer",
          password,
          roles: ["human_reviewer"],
          queues: ["model_risk"],
          country: "IN"
        }).users;

        // 6. Loan Officer
        users = upsertTenantUser(users, {
          userId: "loan_officer_1",
          email: "loan-officer-1@dev.local",
          displayName: "Loan Officer",
          password,
          roles: ["loan_officer"],
          queues: ["loan_ops"],
          country: "IN"
        }).users;

        // 7. Disbursement Maker
        users = upsertTenantUser(users, {
          userId: "disbursement_maker_1",
          email: "disbursement-maker-1@dev.local",
          displayName: "Disbursement Maker",
          password,
          roles: ["disbursement_maker"],
          queues: ["disbursement_ops"],
          country: "IN"
        }).users;

        // 8. Compliance Analyst
        users = upsertTenantUser(users, {
          userId: "compliance_analyst_1",
          email: "compliance-analyst-1@dev.local",
          displayName: "Compliance Analyst",
          password,
          roles: ["compliance_analyst"],
          queues: ["compliance_ops"],
          country: "IN"
        }).users;

        // 9. Collections Manager
        users = upsertTenantUser(users, {
          userId: "collections_manager_1",
          email: "collections-manager-1@dev.local",
          displayName: "Collections Manager",
          password,
          roles: ["collections_manager"],
          queues: ["collections_ops"],
          country: "IN"
        }).users;

        // 10. Collections Lead
        users = upsertTenantUser(users, {
          userId: "collections_lead_1",
          email: "collections-lead-1@dev.local",
          displayName: "Collections Lead",
          password,
          roles: ["workflow_admin"],
          queues: ["*"],
          canAssignQueues: ["collections_ops"],
          country: "IN"
        }).users;

        // 11. Portfolio Risk Manager
        users = upsertTenantUser(users, {
          userId: "portfolio_risk_1",
          email: "portfolio-risk-1@dev.local",
          displayName: "Portfolio Risk Manager",
          password,
          roles: ["portfolio_risk_manager"],
          queues: ["risk_ops"],
          country: "IN"
        }).users;

        // 12. Grievance Officer
        users = upsertTenantUser(users, {
          userId: "grievance_officer_1",
          email: "grievance-officer-1@dev.local",
          displayName: "Grievance Officer",
          password,
          roles: ["grievance_officer"],
          queues: ["grievance_ops"],
          country: "IN"
        }).users;

        // 13. Grievance Lead
        users = upsertTenantUser(users, {
          userId: "grievance_lead_1",
          email: "grievance-lead-1@dev.local",
          displayName: "Grievance Lead",
          password,
          roles: ["workflow_admin"],
          queues: ["*"],
          canAssignQueues: ["grievance_ops"],
          country: "IN"
        }).users;

        // 14. KYC Officer
        users = upsertTenantUser(users, {
          userId: "kyc_officer_1",
          email: "kyc-officer-1@dev.local",
          displayName: "KYC Officer",
          password,
          roles: ["kyc_officer"],
          queues: ["kyc_ops"],
          country: "IN"
        }).users;

        devData.users = users;
        changed = true;
      }
      if (!devData.loanApplications || Object.keys(devData.loanApplications).length === 0) {
        devData.regulatedEntities = {
          "re_1": {
            regulatedEntityId: "re_1",
            name: "India Retail Lending Corp",
            entityType: "nbfc",
            country: "IN",
            website: "https://irlc.co.in",
            privacyPolicyUrl: "https://irlc.co.in/privacy",
            grievanceOfficerName: "Grievance Officer Alpha",
            grievanceOfficerEmail: "grievance@irlc.co.in",
            boardApprovedPolicies: ["credit_policy", "data_retention_policy"],
            dataResidencyPosture: "IN",
            status: "active"
          }
        };

        devData.productPolicies = {
          "prod_1": {
            productId: "prod_1",
            productCode: "RETAIL_PERSONAL_LOAN",
            regulatedEntityId: "re_1",
            currency: "INR",
            minAmount: 10000,
            maxAmount: 100000,
            minTenorMonths: 3,
            maxTenorMonths: 12,
            annualInterestRateBps: 1500,
            aprBps: 1800,
            interestCalcMethod: "reducing_balance",
            pricingPolicyRef: "BOARD-PRICING-2026-V1",
            eligibilityRules: { minAge: 18, maxAge: 65, minIncome: 15000 },
            coolingOffDays: 3,
            recoveryMechanism: "authorized_agency_only",
            status: "active",
            version: 1,
            effectiveFrom: "2026-01-01T00:00:00.000Z",
            effectiveTo: null
          }
        };

        devData.borrowerProfiles = {
          "borrower_1": {
            borrowerId: "borrower_1",
            name: "Rajesh Kumar",
            residencyCountry: "IN",
            address: "123, MG Road, Bangalore, KA, India",
            email: "rajesh@example.com",
            phone: "+919876543210",
            occupation: "salaried",
            monthlyIncome: 45000,
            status: "active"
          },
          "borrower_2": {
            borrowerId: "borrower_2",
            name: "Asha Sharma",
            residencyCountry: "IN",
            address: "456, Linking Road, Mumbai, MH, India",
            email: "asha@example.in",
            phone: "+919988776655",
            occupation: "self_employed",
            monthlyIncome: 85000,
            status: "active"
          },
          "borrower_3": {
            borrowerId: "borrower_3",
            name: "Amit Patel",
            residencyCountry: "IN",
            address: "789, CG Road, Ahmedabad, GJ, India",
            email: "amit@example.com",
            phone: "+919123456789",
            occupation: "student",
            monthlyIncome: 12000,
            status: "active"
          }
        };

        devData.kycRecords = {
          "kyc_1": {
            kycRecordId: "kyc_1",
            borrowerId: "borrower_1",
            status: "verified",
            riskCategory: "medium",
            verifiedAt: "2026-01-10T10:00:00.000Z",
            reviewDueAt: "2034-01-10T10:00:00.000Z"
          },
          "kyc_2": {
            kycRecordId: "kyc_2",
            borrowerId: "borrower_2",
            status: "verified",
            riskCategory: "low",
            verifiedAt: "2026-03-15T09:00:00.000Z",
            reviewDueAt: "2034-03-15T09:00:00.000Z"
          },
          "kyc_3": {
            kycRecordId: "kyc_3",
            borrowerId: "borrower_3",
            status: "verified",
            riskCategory: "low",
            verifiedAt: "2026-05-20T11:30:00.000Z",
            reviewDueAt: "2034-05-20T11:30:00.000Z"
          }
        };

        devData.consentRecords = {
          "consent_1": {
            consentId: "consent_1",
            borrowerId: "borrower_1",
            purpose: "credit_assessment",
            noticeVersion: "v1.0",
            status: "accepted",
            grantedAt: "2026-07-01T12:00:00.000Z"
          },
          "consent_2": {
            consentId: "consent_2",
            borrowerId: "borrower_2",
            purpose: "credit_assessment",
            noticeVersion: "v1.0",
            status: "accepted",
            grantedAt: "2026-07-02T10:00:00.000Z"
          },
          "consent_3": {
            consentId: "consent_3",
            borrowerId: "borrower_3",
            purpose: "credit_assessment",
            noticeVersion: "v1.0",
            status: "accepted",
            grantedAt: "2026-07-03T14:00:00.000Z"
          }
        };

        devData.loanApplications = {
          "app_compliance_blocked": {
            applicationId: "app_compliance_blocked",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 25000,
            tenorMonths: 6,
            status: "blocked_compliance",
            createdAt: "2026-07-09T08:00:00.000Z",
            updatedAt: "2026-07-09T08:00:00.000Z",
            compliance: {
              summary: { status: "blocked", findingsCount: 1 },
              findings: [{ severity: "error", code: "RBI-DL-2025", message: "Non-India borrower residency blocks preflight.", field: "residencyCountry" }]
            },
            workflow: []
          },
          "app_kfs_issued": {
            applicationId: "app_kfs_issued",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 30000,
            tenorMonths: 6,
            status: "kfs_issued",
            createdAt: "2026-07-09T08:15:00.000Z",
            updatedAt: "2026-07-09T08:15:00.000Z",
            kfs: { kfsId: "kfs_102", principal: 30000, tenorMonths: 6, aprBps: 1800 },
            kfsReadiness: { status: "ready" },
            workflow: [{ type: "application.kfs.issued", actor: "system", occurredAt: "2026-07-09T08:16:00.000Z" }]
          },
          "app_refer_underwrite": {
            applicationId: "app_refer_underwrite",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 50000,
            tenorMonths: 12,
            status: "ready_for_decision",
            createdAt: "2026-07-09T08:30:00.000Z",
            updatedAt: "2026-07-09T08:30:00.000Z",
            eligibility: { decision: "refer", reason: "FOIR ratio near threshold limit", foirPercent: 42 },
            workflow: [{ type: "application.kfs.accepted", actor: "borrower_1", occurredAt: "2026-07-09T08:32:00.000Z" }]
          },
          "app_pending_approval": {
            applicationId: "app_pending_approval",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 20000,
            tenorMonths: 6,
            status: "pending_decision_approval",
            createdAt: "2026-07-09T08:45:00.000Z",
            updatedAt: "2026-07-09T08:45:00.000Z",
            pendingDecision: { decision: "approved", proposedBy: "credit_officer_1", proposedAt: "2026-07-09T09:00:00.000Z" },
            workflow: [
              { type: "application.kfs.accepted", actor: "borrower_1", occurredAt: "2026-07-09T08:47:00.000Z" },
              { type: "application.decision.proposed", actor: "credit_officer_1", occurredAt: "2026-07-09T09:00:00.000Z" }
            ]
          },
          "app_disbursement_ready": {
            applicationId: "app_disbursement_ready",
            borrowerId: "borrower_1",
            productId: "prod_1",
            regulatedEntityId: "re_1",
            amount: 40000,
            tenorMonths: 8,
            status: "approved",
            createdAt: "2026-07-09T09:00:00.000Z",
            updatedAt: "2026-07-09T09:00:00.000Z",
            documentPacket: { delivery: { deliveryRef: "MSG-100234", deliveredAt: "2026-07-09T09:10:00.000Z" } },
            workflow: [
              { type: "application.decision.approved", actor: "credit_checker_1", occurredAt: "2026-07-09T09:05:00.000Z" }
            ]
          }
        };

        devData.complaints = {
          "complaint_1": {
            complaintId: "complaint_1",
            borrowerId: "borrower_1",
            category: "delay_in_disbursement",
            summary: "Loan approved yesterday but funds have not cleared in bank account.",
            status: "received",
            receivedAt: "2026-07-09T09:15:00.000Z"
          }
        };
        changed = true;
      }
    }

    if (tenant.demoProfile === DEMO_SHOWCASE_PROFILE_ID && state.tenants[tenant.tenantId]) {
      const before = tenantContentDigest(state.tenants[tenant.tenantId]);
      const profile = buildShowcaseDemoProfile({ tenantId: tenant.tenantId });
      const profiledData = applyShowcaseDemoProfile(state.tenants[tenant.tenantId], profile);
      if (tenantContentDigest(profiledData) !== before) {
        state = {
          ...state,
          tenants: {
            ...state.tenants,
            [tenant.tenantId]: profiledData
          }
        };
        changed = true;
      }
    }
  }
  if (changed) {
    await saveStateFn(state, dataDir);
  }
}

// --- Tenant offboarding: portability export + evidenced deletion ----------

// Deterministic serialization so a content digest is stable regardless of key
// insertion order across load/save round-trips.
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function tenantContentDigest(tenantData) {
  return createHash("sha256").update(canonicalJson(tenantData ?? {})).digest("hex");
}

// A full, self-describing portability pack for one tenant, reproducible from the
// source-of-truth records: the control-plane record, the complete data plane,
// and the tenant-scoped audit evidence pack (with its integrity verdict). This
// is what an exiting regulated entity — or its new provider — receives.
export function buildTenantExport(state, tenantId, { now = new Date() } = {}) {
  const record = state.controlPlane?.tenants?.[tenantId];
  const data = state.tenants?.[tenantId];
  if (!record || !data) {
    return null;
  }
  const auditPack = buildAuditEvidencePack(data.events, tenantId, { now });
  return {
    tenantId,
    generatedAt: now.toISOString(),
    formatVersion: STATE_VERSION,
    tenant: publicTenant(record),
    dataPlane: data,
    audit: auditPack,
    integrity: {
      chainValid: auditPack.integrity.valid,
      eventCount: auditPack.eventCount,
      headHash: auditPack.headHash,
      contentDigest: tenantContentDigest(data)
    }
  };
}

// Evidenced deletion: purge the tenant's data plane but retain a tamper-evident
// attestation in the control plane recording what was erased (event count, audit
// head hash, content digest), who authorized it, and why. The api key is revoked
// and the status moves to `offboarded`, so the tenant can no longer authenticate.
export function offboardTenant(state, tenantId, { actor, reason, now = new Date() } = {}) {
  const record = state.controlPlane?.tenants?.[tenantId];
  const data = state.tenants?.[tenantId];
  if (!record || !data) {
    return null;
  }
  const integrity = verifyAuditChain(data.events, tenantId);
  const attestation = {
    offboardedAt: now.toISOString(),
    actor: actor ?? null,
    reason: reason ?? null,
    erasedEventCount: (data.events ?? []).length,
    auditHeadHash: integrity.headHash ?? null,
    chainValidAtDeletion: integrity.valid,
    contentDigest: tenantContentDigest(data)
  };
  const nextTenants = { ...state.tenants };
  delete nextTenants[tenantId];
  return {
    state: {
      ...state,
      controlPlane: {
        ...state.controlPlane,
        tenants: {
          ...state.controlPlane.tenants,
          [tenantId]: {
            ...record,
            status: "offboarded",
            apiKeyHash: null,
            updatedAt: now.toISOString(),
            offboarding: attestation
          }
        }
      },
      tenants: nextTenants
    },
    attestation
  };
}

export function appendEvent(tenantData, event, now = new Date()) {
  return {
    ...tenantData,
    events: [
      ...(tenantData.events ?? []),
      {
        ...event,
        at: event.at ?? now.toISOString()
      }
    ]
  };
}
