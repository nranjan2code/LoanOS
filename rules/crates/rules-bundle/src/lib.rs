//! Bundle format: canonical bytes, content hashing, ed25519 sign/verify
//! (SEC-2, INV-3), and the per-tenant encryption envelope (SEC-1).
//!
//! A bundle is the signed, encrypted, content-addressed distribution unit of
//! a ruleset. Instances load a bundle only after `verify` succeeds — there is
//! no degraded-mode load path in this API by construction (INV-3).

#![forbid(unsafe_code)]
#![deny(clippy::float_arithmetic)]
#![deny(clippy::disallowed_types)]

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use chrono::{DateTime, FixedOffset};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use rules_model::DecisionModel;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BundleError {
    #[error("bundle serialization failed")]
    Serialize,
    #[error("bundle verification failed: content hash mismatch")]
    HashMismatch,
    #[error("bundle verification failed: bad signature")]
    BadSignature,
    #[error("bundle rejected: author and approver must be distinct (INV-9)")]
    FourEyesViolation,
    #[error("bundle rejected: tenant packs may not contain guardrail.* models")]
    TenantGuardrailModel,
    #[error("bundle rejected: effective_from must be an IST timestamp (+05:30)")]
    NotIst,
    #[error("decryption failed: wrong key or tampered ciphertext")]
    DecryptFailed,
    #[error("encryption failed")]
    EncryptFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BundleKind {
    /// Platform guardrail pack: RBI floors, non-overridable (INV-4).
    Platform,
    /// Tenant policy pack: may only tighten platform bounds.
    Tenant,
}

/// IST offset: +05:30 (INV-12: tenant-facing effective dates are IST).
pub const IST_OFFSET_SECONDS: i32 = 5 * 3600 + 30 * 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub kind: BundleKind,
    /// Required for tenant packs; None for the platform pack.
    pub tenant_id: Option<String>,
    pub version_label: String,
    /// IST effective date (validated by `validate`).
    pub effective_from: DateTime<FixedOffset>,
    /// Distinct authenticated identities (INV-9), recorded in the signed
    /// content so they cannot be repudiated after signing.
    pub author: String,
    pub approver: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bundle {
    pub manifest: Manifest,
    pub models: Vec<DecisionModel>,
}

/// A bundle plus its content hash and control-plane signature. This is the
/// only form an instance ever accepts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SignedBundle {
    pub bundle: Bundle,
    /// `sha256:<hex>` over the bundle's canonical bytes (DEC-5).
    pub hash: String,
    /// ed25519 signature over the canonical bytes, hex-encoded.
    pub signature: String,
}

/// AES-256-GCM envelope for at-rest and in-transit confidentiality (SEC-1).
/// The nonce is caller-supplied: the control plane generates it fresh per
/// seal; tests pass fixed nonces. Key custody is KMS/HSM territory (PH-3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SealedBundle {
    pub nonce: [u8; 12],
    pub ciphertext: Vec<u8>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Canonical JSON bytes (DEC-9): sorted keys, no insignificant whitespace.
pub fn canonical_bytes(bundle: &Bundle) -> Result<Vec<u8>, BundleError> {
    let value = serde_json::to_value(bundle).map_err(|_| BundleError::Serialize)?;
    serde_json::to_vec(&value).map_err(|_| BundleError::Serialize)
}

pub fn content_hash(bundle: &Bundle) -> Result<String, BundleError> {
    Ok(format!(
        "sha256:{}",
        hex(&Sha256::digest(canonical_bytes(bundle)?))
    ))
}

/// Structural validation applied at signing AND at verification (defense in
/// depth): four-eyes (INV-9), tenant packs may not carry guardrail models
/// (DEC-6 static leg), effective dates are IST.
pub fn validate(bundle: &Bundle) -> Result<(), BundleError> {
    if bundle.manifest.author == bundle.manifest.approver {
        return Err(BundleError::FourEyesViolation);
    }
    if bundle.manifest.effective_from.offset().local_minus_utc() != IST_OFFSET_SECONDS {
        return Err(BundleError::NotIst);
    }
    if bundle.manifest.kind == BundleKind::Tenant
        && bundle
            .models
            .iter()
            .any(|m| m.key.starts_with("guardrail."))
    {
        return Err(BundleError::TenantGuardrailModel);
    }
    Ok(())
}

/// Control-plane signing (SEC-2). Refuses structurally invalid bundles: an
/// invalid bundle must never acquire a valid signature.
pub fn sign(bundle: Bundle, key: &SigningKey) -> Result<SignedBundle, BundleError> {
    validate(&bundle)?;
    let bytes = canonical_bytes(&bundle)?;
    let hash = format!("sha256:{}", hex(&Sha256::digest(&bytes)));
    let signature: Signature = key.sign(&bytes);
    Ok(SignedBundle {
        bundle,
        hash,
        signature: hex(&signature.to_bytes()),
    })
}

/// Instance-side verification (INV-3): content hash, signature, and structure
/// must all pass or the bundle does not load. Returns the verified bundle.
pub fn verify(signed: &SignedBundle, key: &VerifyingKey) -> Result<Bundle, BundleError> {
    let bytes = canonical_bytes(&signed.bundle)?;
    let hash = format!("sha256:{}", hex(&Sha256::digest(&bytes)));
    if hash != signed.hash {
        return Err(BundleError::HashMismatch);
    }
    let sig_bytes: [u8; 64] = unhex(&signed.signature)
        .and_then(|v| v.try_into().ok())
        .ok_or(BundleError::BadSignature)?;
    key.verify(&bytes, &Signature::from_bytes(&sig_bytes))
        .map_err(|_| BundleError::BadSignature)?;
    validate(&signed.bundle)?;
    Ok(signed.bundle.clone())
}

/// Seal a signed bundle for distribution (SEC-1). The key is the tenant's
/// bundle key (platform pack uses the platform key).
pub fn seal(
    signed: &SignedBundle,
    key: &[u8; 32],
    nonce: &[u8; 12],
) -> Result<SealedBundle, BundleError> {
    let plaintext = serde_json::to_vec(signed).map_err(|_| BundleError::Serialize)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(nonce), plaintext.as_slice())
        .map_err(|_| BundleError::EncryptFailed)?;
    Ok(SealedBundle {
        nonce: *nonce,
        ciphertext,
    })
}

/// Open a sealed bundle. Decryption alone is NOT loading — callers must still
/// `verify` the result against the control plane's verifying key (INV-3).
pub fn open(sealed: &SealedBundle, key: &[u8; 32]) -> Result<SignedBundle, BundleError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&sealed.nonce),
            sealed.ciphertext.as_slice(),
        )
        .map_err(|_| BundleError::DecryptFailed)?;
    serde_json::from_slice(&plaintext).map_err(|_| BundleError::DecryptFailed)
}
