import { createHash } from "node:crypto";
import { PRODUCT_JOURNEY_TYPES } from "./product-journey-administration.js";
import { PRODUCT_TEMPLATE_CATALOGUE } from "../platform/product-template-catalogue.js";

export { PRODUCT_JOURNEY_TYPES };
export const JOURNEY_SUPPORT_LEVELS = Object.freeze(["planned","orchestration_only","configurable_pattern","controlled_first_slice","production_ready"]);
export const JOURNEY_PRODUCTION_EVIDENCE_DOMAINS = Object.freeze([
  "journey_conformance",
  "tenant_uat",
  "provider_certification",
  "accounting_certification",
  "regulatory_certification",
  "operations_acceptance",
  "security_assurance",
  "deployment_acceptance",
  "resilience_exercise",
  "support_acceptance",
  "exit_acceptance"
]);
export const JOURNEY_PRODUCTION_EVIDENCE_REGISTRY_TYPES = Object.freeze(["provider", "deployment", "institution"]);
export const JOURNEY_PRODUCTION_EVIDENCE_DOMAIN_GROUPS = Object.freeze({
  provider: Object.freeze(["provider_certification"]),
  deployment: Object.freeze(["security_assurance", "deployment_acceptance", "resilience_exercise", "exit_acceptance"]),
  institution: Object.freeze(["journey_conformance", "tenant_uat", "accounting_certification", "regulatory_certification", "operations_acceptance", "support_acceptance"])
});
const LEVEL_REQUIREMENTS = Object.freeze({
  planned: [], orchestration_only: ["architectureRef", "workflowTestRef"], configurable_pattern: ["configurationSchemaRef", "domainTestRef", "policyBindingRef"], controlled_first_slice: ["configurationSchemaRef", "domainTestRef", "policyBindingRef", "endToEndTestRef", "accountingControlRef", "complianceControlRef"], production_ready: ["configurationSchemaRef", "domainTestRef", "policyBindingRef", "endToEndTestRef", "accountingControlRef", "complianceControlRef", "operationalRunRef", "securityAssessmentRef", "drExerciseRef"]
});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})}; const text=(v,f)=>{if(typeof v!=="string"||!v.trim())fail("journey_certification_invalid",`${f} is required.`);return v.trim()}; const sha=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex"); const approve=i=>{text(i.proposedBy,"proposedBy");text(i.approvedBy,"approvedBy");text(i.approvalRef,"approvalRef");if(i.proposedBy===i.approvedBy)fail("journey_certification_four_eyes","Independent approval is required.")};
const isSha256=value=>typeof value==="string"&&/^[a-f0-9]{64}$/i.test(value);

export function registerProductJourneyProductionEvidence(registries={},input={},now=new Date()){
  const registryType=text(input.registryType,"registryType");if(!JOURNEY_PRODUCTION_EVIDENCE_REGISTRY_TYPES.includes(registryType))fail("journey_production_registry_type_invalid","Unknown production evidence registry type.");
  const evidenceId=text(input.evidenceId,"evidenceId"),tenantId=text(input.tenantId,"tenantId"),journeyType=text(input.journeyType,"journeyType"),templateVersion=text(input.templateVersion,"templateVersion"),configurationVersion=text(input.configurationVersion,"configurationVersion");
  if(!PRODUCT_JOURNEY_TYPES.includes(journeyType))fail("journey_type_invalid","Production evidence requires a canonical product journey type.");approve(input);
  const evidence=Array.isArray(input.evidence)?input.evidence:[];const requiredDomains=JOURNEY_PRODUCTION_EVIDENCE_DOMAIN_GROUPS[registryType];const domains=evidence.map(item=>item?.domain);
  if(evidence.length!==requiredDomains.length||requiredDomains.some(domain=>domains.filter(value=>value===domain).length!==1)||domains.some(domain=>!requiredDomains.includes(domain)))fail("journey_production_registry_domains_invalid",`${registryType} evidence must contain exactly: ${requiredDomains.join(", ")}.`);
  for(const item of evidence){const findings=validateEvidenceItem(item,{tenantId,journeyType,templateVersion,configurationVersion},now);if(findings.length)fail("journey_production_registry_evidence_invalid",`${item.domain}: ${findings.join(", ")}.`)}
  const externalDependencies=registryType==="provider"?(Array.isArray(input.externalDependencies)?input.externalDependencies:[]):[];
  if(registryType==="provider"){const dependencyFindings=validateProviderDependencies(externalDependencies,{tenantId,journeyType,templateVersion,configurationVersion},now);if(dependencyFindings.length)fail("journey_production_registry_provider_invalid",dependencyFindings.join(", "));}
  const activationBindings=registryType==="institution"?Object.fromEntries(["tenantJourneyConfigRef","regulatedEntityRef","productPolicyRef","operationsOwnerRef","tenantUatRef"].map(field=>[field,text(input.activationBindings?.[field],`activationBindings.${field}`)])):null;
  const validUntil=new Date(input.validUntil);if(!Number.isFinite(validUntil.getTime())||validUntil<=now)fail("journey_production_registry_expiry_invalid","Production evidence registry entry needs a future expiry.");
  const artifactBindings=Array.isArray(input.artifactBindings)?input.artifactBindings.map(binding=>({artifactId:text(binding?.artifactId,"artifactBindings[].artifactId"),artifactChecksumSha256:text(binding?.artifactChecksumSha256,"artifactBindings[].artifactChecksumSha256")})):[];
  for(const binding of artifactBindings)if(!isSha256(binding.artifactChecksumSha256))fail("journey_production_artifact_checksum_invalid","Artifact binding checksum must be SHA-256.");
  const immutable={registryType,evidenceId,tenantId,journeyType,templateVersion,configurationVersion,evidence,externalDependencies,activationBindings,artifactBindings,validUntil:validUntil.toISOString()};const checksumSha256=sha(immutable);const current=registries?.[registryType]?.[evidenceId];if(current){if(current.checksumSha256===checksumSha256)return{registries,record:current,idempotent:true};fail("journey_production_registry_conflict","evidenceId is already bound to different evidence.");}
  const record={...immutable,checksumSha256,status:"active",proposedBy:input.proposedBy,approvedBy:input.approvedBy,approvalRef:input.approvalRef,registeredAt:now.toISOString()};return{registries:{...registries,[registryType]:{...(registries?.[registryType]??{}),[evidenceId]:record}},record,idempotent:false};
}

export function resolveProductJourneyProductionEvidence(registries={},input={},now=new Date()){
  const scope={tenantId:text(input.tenantId,"tenantId"),journeyType:text(input.journeyType,"journeyType"),templateVersion:text(input.templateVersion,"templateVersion"),configurationVersion:text(input.configurationVersion,"configurationVersion")};
  const refs={providerEvidenceId:text(input.productionRegistryRefs?.providerEvidenceId,"productionRegistryRefs.providerEvidenceId"),deploymentEvidenceId:text(input.productionRegistryRefs?.deploymentEvidenceId,"productionRegistryRefs.deploymentEvidenceId"),institutionEvidenceId:text(input.productionRegistryRefs?.institutionEvidenceId,"productionRegistryRefs.institutionEvidenceId")};
  const records={provider:registries?.provider?.[refs.providerEvidenceId],deployment:registries?.deployment?.[refs.deploymentEvidenceId],institution:registries?.institution?.[refs.institutionEvidenceId]};
  for(const type of JOURNEY_PRODUCTION_EVIDENCE_REGISTRY_TYPES){const record=records[type];if(!record||record.status!=="active")fail("journey_production_registry_record_missing",`Active ${type} evidence is required.`);if(record.checksumSha256!==registryRecordChecksum(record))fail("journey_production_registry_checksum_mismatch",`${type} evidence checksum does not match its persisted content.`);if(Date.parse(record.validUntil)<=now.getTime())fail("journey_production_registry_record_expired",`${type} evidence has expired.`);for(const field of Object.keys(scope))if(String(record[field])!==scope[field])fail("journey_production_registry_scope_mismatch",`${type} evidence ${field} does not match the certification scope.`);for(const binding of record.artifactBindings??[]){const artifact=input.productionArtifacts?.[binding.artifactId];if(!artifact||artifact.status!=="active")fail("journey_production_artifact_not_current",`Active source artifact ${binding.artifactId} is required.`);if(artifact.artifactChecksumSha256!==binding.artifactChecksumSha256)fail("journey_production_artifact_not_current",`Source artifact ${binding.artifactId} changed after evidence registration.`);if(Date.parse(artifact.validUntil)<=now.getTime())fail("journey_production_artifact_not_current",`Source artifact ${binding.artifactId} has expired.`);}}
  const productionEvidence=JOURNEY_PRODUCTION_EVIDENCE_REGISTRY_TYPES.flatMap(type=>records[type].evidence);const externalDependencies=records.provider.externalDependencies;
  const assessment=assessProductJourneyProductionReadiness({...scope,evidence:productionEvidence,externalDependencies},now);if(assessment.status!=="production_ready")fail("journey_production_readiness_blocked",`Trusted production evidence is incomplete: ${assessment.reasons.join(", ")}`);
  return{...scope,productionRegistryRefs:refs,records,productionEvidence,externalDependencies,activationBindings:records.institution.activationBindings,providerReadinessRef:`journey-provider-evidence/${refs.providerEvidenceId}/${records.provider.checksumSha256}`,deploymentReadinessRef:`journey-deployment-evidence/${refs.deploymentEvidenceId}/${records.deployment.checksumSha256}`,institutionReadinessRef:`journey-institution-evidence/${refs.institutionEvidenceId}/${records.institution.checksumSha256}`,assessment};
}

export function assessProductJourneyProductionReadiness(input={},now=new Date()){
  const tenantId=text(input.tenantId,"tenantId");
  const journeyType=text(input.journeyType,"journeyType");
  const templateVersion=text(input.templateVersion,"templateVersion");
  const configurationVersion=text(input.configurationVersion,"configurationVersion");
  if(!PRODUCT_JOURNEY_TYPES.includes(journeyType))fail("journey_type_invalid","Production readiness requires a canonical product journey type.");
  const evidence=Array.isArray(input.evidence)?input.evidence:[];
  const dependencies=Array.isArray(input.externalDependencies)?input.externalDependencies:[];
  const reasons=[];
  const results=JOURNEY_PRODUCTION_EVIDENCE_DOMAINS.map(domain=>{
    const matches=evidence.filter(item=>item?.domain===domain);
    const item=matches[0];
    const findings=[];
    if(matches.length!==1)findings.push(matches.length?"duplicate_evidence":"evidence_missing");
    if(item){
      if(item.tenantId!==tenantId)findings.push("tenant_scope_mismatch");
      if(item.journeyType!==journeyType)findings.push("journey_scope_mismatch");
      if(String(item.templateVersion)!==templateVersion)findings.push("template_version_mismatch");
      if(String(item.configurationVersion)!==configurationVersion)findings.push("configuration_version_mismatch");
      if(!["passed","certified","accepted"].includes(item.status))findings.push("status_not_accepted");
      if(!isSha256(item.evidenceChecksumSha256))findings.push("checksum_invalid");
      const observedAt=Date.parse(item.observedAt);
      const validUntil=Date.parse(item.validUntil);
      if(!Number.isFinite(observedAt)||observedAt>now.getTime())findings.push("observation_time_invalid");
      if(!Number.isFinite(validUntil)||validUntil<=now.getTime())findings.push("evidence_expired");
      if(!item.producedBy||!item.approvedBy||item.producedBy===item.approvedBy)findings.push("independent_approval_missing");
    }
    for(const finding of findings)reasons.push(`${domain}:${finding}`);
    return{domain,status:findings.length?"blocked":"ready",findings,evidenceRef:item?.evidenceRef??null,evidenceChecksumSha256:item?.evidenceChecksumSha256??null,observedAt:item?.observedAt??null,validUntil:item?.validUntil??null,producedBy:item?.producedBy??null,approvedBy:item?.approvedBy??null};
  });
  const requiredProviderFamilies=PRODUCT_TEMPLATE_CATALOGUE[journeyType]?.integrationsProviders??[];
  const familyCounts=new Map();for(const item of dependencies)familyCounts.set(item?.providerFamily,(familyCounts.get(item?.providerFamily)??0)+1);
  for(const family of requiredProviderFamilies){const count=familyCounts.get(family)??0;if(count===0)reasons.push(`external_dependency:${family}:missing`);if(count>1)reasons.push(`external_dependency:${family}:duplicate`);}
  for(const family of familyCounts.keys())if(!requiredProviderFamilies.includes(family))reasons.push(`external_dependency:${family}:unexpected`);
  const dependencyResults=dependencies.map((item,index)=>{
    const findings=[];
    if(item?.tenantId!==tenantId)findings.push("tenant_scope_mismatch");
    if(item?.journeyType!==journeyType)findings.push("journey_scope_mismatch");
    if(String(item?.templateVersion)!==templateVersion)findings.push("template_version_mismatch");
    if(String(item?.configurationVersion)!==configurationVersion)findings.push("configuration_version_mismatch");
    if(item?.status!=="certified")findings.push("status_not_certified");
    if(item?.dataResidencyCountry!=="IN")findings.push("india_residency_missing");
    if(!item?.providerFamily||!item?.certificationRef||!item?.mappingRef||!item?.reconciliationRef)findings.push("operational_lineage_missing");
    if(!isSha256(item?.evidenceChecksumSha256))findings.push("checksum_invalid");
    if(!Number.isFinite(Date.parse(item?.validUntil))||Date.parse(item.validUntil)<=now.getTime())findings.push("certification_expired");
    for(const finding of findings)reasons.push(`external_dependency_${index}:${finding}`);
    return{providerFamily:item?.providerFamily??null,status:findings.length?"blocked":"ready",findings,certificationRef:item?.certificationRef??null,mappingRef:item?.mappingRef??null,reconciliationRef:item?.reconciliationRef??null,evidenceChecksumSha256:item?.evidenceChecksumSha256??null,validUntil:item?.validUntil??null};
  });
  const normalized={tenantId,journeyType,templateVersion,configurationVersion,requiredProviderFamilies,results,dependencyResults};
  return{...normalized,status:reasons.length?"blocked":"production_ready",reasons,evidenceChecksumSha256:sha(normalized),assessedAt:now.toISOString()};
}

export function certifyProductJourneySupport(registry={},input={},now=new Date()){
  const journeyType=text(input.journeyType,"journeyType");const tenantId=text(input.tenantId,"tenantId");if(!PRODUCT_JOURNEY_TYPES.includes(journeyType)){const template=input.templateDefinition;if(!template||template.journeyType!==journeyType||template.status!=="active"||!template.templateId||!Number.isInteger(template.version)||(template.scope==="tenant"&&template.tenantId!==tenantId)||!["platform","tenant"].includes(template.scope))fail("journey_type_invalid","Unknown or inactive product journey template.");}const supportLevel=text(input.supportLevel,"supportLevel");if(!JOURNEY_SUPPORT_LEVELS.includes(supportLevel))fail("journey_support_level_invalid","Unknown support level.");approve(input);const certificationId=text(input.certificationId,"certificationId");const templateVersion=text(input.templateVersion,"templateVersion");const evidence={};for(const field of LEVEL_REQUIREMENTS[supportLevel])evidence[field]=text(input.evidence?.[field],`evidence.${field}`);let productionAssessment=null;let configurationVersion=null;if(supportLevel==="production_ready"){configurationVersion=text(input.configurationVersion,"configurationVersion");productionAssessment=assessProductJourneyProductionReadiness({tenantId,journeyType,templateVersion,configurationVersion,evidence:input.productionEvidence,externalDependencies:input.externalDependencies},now);if(productionAssessment.status!=="production_ready")fail("journey_production_readiness_blocked",`Production evidence is incomplete: ${productionAssessment.reasons.join(", ")}`);text(input.productionReadinessRef,"productionReadinessRef")}
  const validUntil=new Date(input.validUntil);if(!Number.isFinite(validUntil.getTime())||validUntil<=now)fail("journey_certification_expiry_invalid","Certification needs a future expiry.");const scope={tenantId,certificationId,journeyType,supportLevel,templateVersion,configurationVersion,evidence,productionEvidence:input.productionEvidence??[],externalDependencies:input.externalDependencies??[],productionRegistryRefs:input.productionRegistryRefs??null,productionReadinessRef:input.productionReadinessRef??null,productionAssessmentChecksumSha256:productionAssessment?.evidenceChecksumSha256??null};const checksumSha256=sha(scope);const key=`${tenantId}:${journeyType}`;const previous=registry[key];if(previous){if(previous.checksumSha256===checksumSha256)return{registry,certification:previous,idempotent:true};if(previous.status==="active")fail("journey_certification_replacement_blocked","Suspend the active certification before replacement.")}
  const certification={...scope,checksumSha256,status:"active",proposedBy:input.proposedBy,approvedBy:input.approvedBy,approvalRef:input.approvalRef,validUntil:validUntil.toISOString(),certifiedAt:now.toISOString()};return{registry:{...registry,[key]:certification},certification,idempotent:false};
}

export function suspendProductJourneySupport(registry={},input={},now=new Date()){const key=`${text(input.tenantId,"tenantId")}:${text(input.journeyType,"journeyType")}`;const current=registry[key];if(!current||current.status!=="active")fail("journey_certification_missing","Active certification is required.");approve(input);const updated={...current,status:"suspended",suspension:{reason:text(input.reason,"reason"),evidenceRef:text(input.evidenceRef,"evidenceRef"),proposedBy:input.proposedBy,approvedBy:input.approvedBy,approvalRef:input.approvalRef,suspendedAt:now.toISOString()}};return{registry:{...registry,[key]:updated},certification:updated};}

export function projectProductJourneySupport(registry={},tenantId,now=new Date()){text(tenantId,"tenantId");const journeys=PRODUCT_JOURNEY_TYPES.map(journeyType=>{const record=registry[`${tenantId}:${journeyType}`];const active=record?.status==="active"&&new Date(record.validUntil)>now;return{journeyType,supportLevel:active?record.supportLevel:"planned",certificationId:active?record.certificationId:null,validUntil:active?record.validUntil:null,status:active?"certified":record?.status==="suspended"?"suspended":record&&new Date(record.validUntil)<=now?"expired":"uncertified",publicClaimAllowed:active&&["configurable_pattern","controlled_first_slice","production_ready"].includes(record.supportLevel)}});return{tenantId,journeys,counts:Object.fromEntries(JOURNEY_SUPPORT_LEVELS.map(level=>[level,journeys.filter(item=>item.supportLevel===level).length])),allJourneyTypesCovered:journeys.length===21,generatedAt:now.toISOString()};}

export function assessTenantJourneyActivation(certifications={},input={},now=new Date()){const key=`${text(input.tenantId,"tenantId")}:${text(input.journeyType,"journeyType")}`;const certification=certifications[key];const reasons=[];if(!certification||certification.status!=="active")reasons.push("support_certification_missing");else if(new Date(certification.validUntil)<=now)reasons.push("support_certification_expired");for(const ref of ["tenantJourneyConfigRef","regulatedEntityRef","productPolicyRef","operationsOwnerRef","tenantUatRef"])if(!input[ref])reasons.push(`${ref}_missing`);if(input.liveMode){if(certification?.supportLevel!=="production_ready"||!certification?.productionAssessmentChecksumSha256)reasons.push("production_support_certification_missing");if(certification?.supportLevel==="production_ready"){if(String(input.templateVersion)!==certification.templateVersion)reasons.push("production_template_version_mismatch");if(String(input.configurationVersion)!==certification.configurationVersion)reasons.push("production_configuration_version_mismatch");const current=assessProductJourneyProductionReadiness({tenantId:input.tenantId,journeyType:input.journeyType,templateVersion:certification.templateVersion,configurationVersion:certification.configurationVersion,evidence:input.currentProductionEvidence??certification.productionEvidence,externalDependencies:input.currentExternalDependencies??certification.externalDependencies},now);if(current.status!=="production_ready"||current.evidenceChecksumSha256!==certification.productionAssessmentChecksumSha256)reasons.push("production_evidence_not_current");}if(!input.providerReadinessRef)reasons.push("provider_readiness_missing");if(!input.deploymentReadinessRef)reasons.push("deployment_readiness_missing");if(!input.institutionReadinessRef)reasons.push("institution_readiness_missing");}return{tenantId:input.tenantId,journeyType:input.journeyType,status:reasons.length?"blocked":"ready",reasons,supportLevel:certification?.supportLevel??"planned"};}

function validateEvidenceItem(item,scope,now){const findings=[];if(item?.tenantId!==scope.tenantId)findings.push("tenant_scope_mismatch");if(item?.journeyType!==scope.journeyType)findings.push("journey_scope_mismatch");if(String(item?.templateVersion)!==scope.templateVersion)findings.push("template_version_mismatch");if(String(item?.configurationVersion)!==scope.configurationVersion)findings.push("configuration_version_mismatch");if(!["passed","certified","accepted"].includes(item?.status))findings.push("status_not_accepted");if(!isSha256(item?.evidenceChecksumSha256))findings.push("checksum_invalid");const observedAt=Date.parse(item?.observedAt),validUntil=Date.parse(item?.validUntil);if(!Number.isFinite(observedAt)||observedAt>now.getTime())findings.push("observation_time_invalid");if(!Number.isFinite(validUntil)||validUntil<=now.getTime())findings.push("evidence_expired");if(!item?.producedBy||!item?.approvedBy||item.producedBy===item.approvedBy)findings.push("independent_approval_missing");if(!item?.evidenceRef)findings.push("evidence_ref_missing");return findings;}
function validateProviderDependencies(dependencies,scope,now){const findings=[];const required=PRODUCT_TEMPLATE_CATALOGUE[scope.journeyType]?.integrationsProviders??[];for(const family of required){const matches=dependencies.filter(item=>item?.providerFamily===family);if(matches.length!==1)findings.push(`${family}:${matches.length?"duplicate":"missing"}`);}for(const item of dependencies){if(!required.includes(item?.providerFamily))findings.push(`${item?.providerFamily}:unexpected`);if(item?.tenantId!==scope.tenantId)findings.push(`${item?.providerFamily}:tenant_scope_mismatch`);if(item?.journeyType!==scope.journeyType)findings.push(`${item?.providerFamily}:journey_scope_mismatch`);if(String(item?.templateVersion)!==scope.templateVersion)findings.push(`${item?.providerFamily}:template_version_mismatch`);if(String(item?.configurationVersion)!==scope.configurationVersion)findings.push(`${item?.providerFamily}:configuration_version_mismatch`);if(item?.status!=="certified")findings.push(`${item?.providerFamily}:status_not_certified`);if(item?.dataResidencyCountry!=="IN")findings.push(`${item?.providerFamily}:india_residency_missing`);if(!item?.certificationRef||!item?.mappingRef||!item?.reconciliationRef)findings.push(`${item?.providerFamily}:operational_lineage_missing`);if(!isSha256(item?.evidenceChecksumSha256))findings.push(`${item?.providerFamily}:checksum_invalid`);if(!Number.isFinite(Date.parse(item?.validUntil))||Date.parse(item.validUntil)<=now.getTime())findings.push(`${item?.providerFamily}:certification_expired`);}return findings;}
function registryRecordChecksum(record){return sha(Object.fromEntries(["registryType","evidenceId","tenantId","journeyType","templateVersion","configurationVersion","evidence","externalDependencies","activationBindings","artifactBindings","validUntil"].map(field=>[field,record[field]??(field==="artifactBindings"?[]:record[field])])));}
