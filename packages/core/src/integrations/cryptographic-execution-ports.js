/**
 * Cryptographic execution ports: the boundary between domain code and the
 * actual key-management providers (KMS/HSM/PGP). This module never performs
 * cryptography itself and never touches raw key material — it only (a) binds
 * a tenant/purpose-scoped key identity to a provider-attested, non-exportable
 * key handle, (b) forwards operations (encrypt/decrypt/sign/verify/envelope)
 * to the caller-supplied `adapter` for that provider, and (c) records
 * checksummed evidence of every operation for the audit trail. Provider
 * adapters (the actual KMS/HSM SDK calls) are injected by the caller, not
 * owned here — this keeps the pure domain layer free of I/O per AGENTS.md's
 * "policy is data" / determinism conventions, and lets each provider's
 * client library live outside `packages/core`.
 *
 * Every mutating export requires two independent identities
 * (`proposedBy` !== `approvedBy`, via `eyes()`) before a key can be
 * registered or rotated — key lifecycle is a four-eyes action, not a
 * single-operator one. Credentials are only ever accepted as an opaque
 * `kms://`/`vault://`/`secret://` reference (`secretRef()`); raw credentials,
 * secrets, or private keys passed to `executeCryptographicOperation` are
 * rejected outright (`crypto_raw_credential_forbidden`).
 */
import { createHash } from "node:crypto";

const PROVIDERS = new Set(["kms", "hsm", "pgp"]); const OPERATIONS = new Set(["encrypt", "decrypt", "sign", "verify", "envelope_encrypt", "envelope_decrypt"]);
function fail(code,message){const e=new Error(message);e.code=code;throw e;} function text(v,f){if(typeof v!=="string"||!v.trim())fail("crypto_port_invalid",`${f} is required.`);return v.trim();} function eyes(i){text(i.proposedBy,"proposedBy");text(i.approvedBy,"approvedBy");text(i.approvalRef,"approvalRef");if(i.proposedBy===i.approvedBy)fail("crypto_port_four_eyes_required","Independent approval is required.");} function sha(v){return createHash("sha256").update(typeof v==="string"||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest("hex");} function map(s,k){return s[k]??{};} function secretRef(v){if(!/^(kms|vault|secret):\/\/[A-Za-z0-9._/-]+$/.test(v??""))fail("crypto_credential_ref_invalid","Credential must be supplied only by KMS, vault, or secret reference.");return v;} function scope(binding,i){if(binding.tenantId!==i.tenantId)fail("crypto_tenant_mismatch","Key is outside tenant scope.");if(binding.purpose!==i.purpose)fail("crypto_purpose_mismatch","Key is outside permitted purpose.");}

/**
 * Bind a new key identity to a provider-attested, non-exportable key handle.
 * Requires four-eyes approval (`eyes()`) and an opaque credential reference;
 * the provider `adapter` must attest back that the key is active and
 * non-exportable (`crypto_key_attestation_failed` otherwise) — this module
 * never generates or holds key material itself, only records the binding.
 * @param {object} state - domain state holding the `cryptographicKeys` map.
 * @param {object} input - keyId/provider/keyRef/credentialRef/tenantId/purpose plus proposedBy/approvedBy/approvalRef.
 * @param {object} adapter - provider adapter implementing `attestKey`.
 * @param {Date} [now]
 * @returns {Promise<{state: object, binding: object}>}
 */
export async function registerCryptographicKey(state,input,adapter,now=new Date()){
  eyes(input);const keyId=text(input.keyId,"keyId"),provider=text(input.provider,"provider");if(!PROVIDERS.has(provider))fail("crypto_provider_invalid","Provider must be kms, hsm, or pgp.");if(map(state,"cryptographicKeys")[keyId])fail("crypto_key_exists","Key already exists.");secretRef(input.credentialRef);text(input.keyRef,"keyRef");text(input.tenantId,"tenantId");text(input.purpose,"purpose");if(input.keyRef.includes(input.credentialRef))fail("crypto_key_ref_invalid","Key and credential references must be distinct.");
  const attestation=await call(adapter,"attestKey",{provider,keyRef:input.keyRef,credentialRef:input.credentialRef});if(attestation?.nonExportable!==true||attestation?.status!=="attested"||!attestation.attestationRef||!attestation.algorithm)fail("crypto_key_attestation_failed","Provider must attest a non-exportable active key.");
  const binding={keyId,provider,keyRef:input.keyRef,credentialRef:input.credentialRef,tenantId:input.tenantId,purpose:input.purpose,version:1,status:"active",algorithm:attestation.algorithm,nonExportable:true,attestationRef:attestation.attestationRef,attestationChecksumSha256:sha(attestation),proposedBy:input.proposedBy,approvedBy:input.approvedBy,approvalRef:input.approvalRef,activatedAt:now.toISOString()};return{state:{...state,cryptographicKeys:{...map(state,"cryptographicKeys"),[keyId]:binding}},binding};
}

/**
 * Perform one cryptographic operation (encrypt/decrypt/sign/verify/envelope)
 * against the active binding for `input.keyId`, via the caller-supplied
 * `adapters[binding.provider]` — never a local crypto implementation. Rejects
 * any raw `credential`/`secret`/`privateKey` field outright
 * (`crypto_raw_credential_forbidden`): only the provider ever sees key
 * material. Every call is recorded as checksummed evidence (input/output
 * SHA-256 + the provider's own operation reference) rather than the raw
 * plaintext/ciphertext, so evidence can be retained without becoming a
 * second copy of sensitive data.
 * @param {object} state - domain state holding `cryptographicKeys` and evidence.
 * @param {object} input - operation, keyId, expectedKeyVersion, and operation-specific bytes.
 * @param {Record<string, object>} adapters - provider name -> adapter implementing the operation methods.
 * @param {Date} [now]
 * @returns {Promise<{output: object, evidence: object, state: object}>}
 */
export async function executeCryptographicOperation(state,input,adapters,now=new Date()){
  const binding=map(state,"cryptographicKeys")[text(input.keyId,"keyId")];if(!binding||binding.status!=="active")fail("crypto_key_inactive","Active key binding is required.");scope(binding,input);if(input.expectedKeyVersion!==binding.version)fail("crypto_key_version_conflict","Expected key version does not match active binding.");const operation=text(input.operation,"operation");if(!OPERATIONS.has(operation))fail("crypto_operation_invalid","Unsupported cryptographic operation.");const adapter=adapters?.[binding.provider];if(!adapter)fail("crypto_adapter_missing","Configured provider adapter is unavailable.");
  if(Object.hasOwn(input,"credential")||Object.hasOwn(input,"secret")||Object.hasOwn(input,"privateKey"))fail("crypto_raw_credential_forbidden","Raw credentials and private keys are forbidden.");const context={tenantId:binding.tenantId,purpose:binding.purpose,keyRef:binding.keyRef,credentialRef:binding.credentialRef,keyVersion:binding.version,aad:input.aad??null};let result;
  if(operation==="encrypt")result=await call(adapter,"encrypt",{...context,plaintext:requiredBytes(input.plaintext,"plaintext")});else if(operation==="decrypt")result=await call(adapter,"decrypt",{...context,ciphertext:requiredBytes(input.ciphertext,"ciphertext")});else if(operation==="sign")result=await call(adapter,"sign",{...context,message:requiredBytes(input.message,"message")});else if(operation==="verify")result=await call(adapter,"verify",{...context,message:requiredBytes(input.message,"message"),signature:requiredBytes(input.signature,"signature")});else if(operation==="envelope_encrypt")result=await call(adapter,"envelopeEncrypt",{...context,plaintext:requiredBytes(input.plaintext,"plaintext")});else result=await call(adapter,"envelopeDecrypt",{...context,ciphertext:requiredBytes(input.ciphertext,"ciphertext"),wrappedDataKey:requiredBytes(input.wrappedDataKey,"wrappedDataKey")});
  validateResult(operation,result);const output=operation==="verify"?{verified:result.verified}:operation.includes("decrypt")?{plaintext:result.plaintext}:operation==="sign"?{signature:result.signature}:{ciphertext:result.ciphertext,...(operation==="envelope_encrypt"?{wrappedDataKey:result.wrappedDataKey}: {})};const evidence={operationId:text(input.operationId,"operationId"),keyId:binding.keyId,keyVersion:binding.version,provider:binding.provider,operation,tenantId:binding.tenantId,purpose:binding.purpose,inputChecksumSha256:sha(operation.includes("decrypt")?input.ciphertext:input.message??input.plaintext),outputChecksumSha256:sha(operation==="verify"?String(result.verified):result.signature??result.ciphertext??result.plaintext),providerOperationRef:text(result.providerOperationRef,"providerOperationRef"),executedAt:now.toISOString()};
  return{output,evidence,state:{...state,cryptographicOperationEvidence:{...map(state,"cryptographicOperationEvidence"),[evidence.operationId]:evidence}}};
}

/**
 * Rotate a key binding to a new provider key reference. Requires four-eyes
 * approval and a fresh attestation from the provider (the new key must also
 * be non-exportable); the retired version is preserved in `history` so past
 * evidence records (which cite a `keyVersion`) remain interpretable after
 * rotation. `expectedVersion` guards against a lost-update race with a
 * concurrent rotation or use.
 * @param {object} state - domain state holding the `cryptographicKeys` map.
 * @param {object} input - keyId, expectedVersion, newKeyRef, proposedBy/approvedBy/approvalRef.
 * @param {object} adapter - provider adapter implementing `attestKey`.
 * @param {Date} [now]
 * @returns {Promise<{state: object, binding: object}>}
 */
export async function rotateCryptographicKey(state,input,adapter,now=new Date()){
  eyes(input);const current=map(state,"cryptographicKeys")[input.keyId];if(!current||current.status!=="active")fail("crypto_key_inactive","Active key binding is required.");scope(current,input);if(input.expectedVersion!==current.version)fail("crypto_key_version_conflict","Expected key version does not match active binding.");text(input.newKeyRef,"newKeyRef");if(input.newKeyRef===current.keyRef)fail("crypto_rotation_invalid","Rotation requires a different provider key reference.");const attestation=await call(adapter,"attestKey",{provider:current.provider,keyRef:input.newKeyRef,credentialRef:current.credentialRef});if(attestation?.nonExportable!==true||attestation?.status!=="attested")fail("crypto_key_attestation_failed","Replacement key must be non-exportable and attested.");const history=[...(current.history??[]),{version:current.version,keyRef:current.keyRef,retiredAt:now.toISOString(),attestationRef:current.attestationRef}];const binding={...current,keyRef:input.newKeyRef,version:current.version+1,algorithm:attestation.algorithm,attestationRef:text(attestation.attestationRef,"attestationRef"),attestationChecksumSha256:sha(attestation),history,proposedBy:input.proposedBy,approvedBy:input.approvedBy,approvalRef:input.approvalRef,rotatedAt:now.toISOString()};return{state:{...state,cryptographicKeys:{...map(state,"cryptographicKeys"),[binding.keyId]:binding}},binding};
}

// Invoke one adapter method, normalizing "adapter doesn't implement this" and
// thrown provider errors into the same fail-closed error shape as validation.
async function call(adapter,method,input){if(!adapter||typeof adapter[method]!=="function")fail("crypto_adapter_missing",`Provider adapter does not implement ${method}.`);try{return await adapter[method](input);}catch(error){fail("crypto_provider_failure",`Cryptographic provider operation failed: ${error?.message??"unknown error"}`);}} function requiredBytes(v,f){if(!(typeof v==="string"||Buffer.isBuffer(v))||v.length===0)fail("crypto_port_invalid",`${f} is required.`);return v;} function validateResult(op,r){if(!r||!r.providerOperationRef)fail("crypto_provider_result_invalid","Provider evidence reference is required.");if(op==="verify"&&typeof r.verified!=="boolean")fail("crypto_provider_result_invalid","Verify result is invalid.");if(op==="sign"&&!r.signature)fail("crypto_provider_result_invalid","Signature is missing.");if(op==="envelope_encrypt"&&(!r.ciphertext||!r.wrappedDataKey||r.plaintextDataKey))fail("crypto_provider_result_invalid","Envelope result must contain ciphertext and wrapped key only.");if(op==="encrypt"&&!r.ciphertext||op.includes("decrypt")&&!r.plaintext)fail("crypto_provider_result_invalid","Cryptographic output is missing.");}
