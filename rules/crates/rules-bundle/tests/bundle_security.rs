//! SEC-1/SEC-2/INV-3/INV-9 test suite: signing, verification, tampering,
//! wrong keys, encryption envelope, and structural gates.

use std::collections::BTreeMap;

use chrono::DateTime;
use ed25519_dalek::SigningKey;
use rules_bundle::{
    canonical_bytes, content_hash, open, seal, sign, verify, Bundle, BundleError, BundleKind,
    Manifest,
};
use rules_model::{DecisionModel, OutcomeRule};

fn model(key: &str) -> DecisionModel {
    DecisionModel {
        key: key.into(),
        bindings: vec![],
        expressions: vec![],
        findings: vec![],
        outcome: OutcomeRule::SeverityFold,
        outputs: BTreeMap::new(),
    }
}

fn bundle() -> Bundle {
    Bundle {
        manifest: Manifest {
            kind: BundleKind::Tenant,
            tenant_id: Some("ten_udaan_nbfc".into()),
            version_label: "2026.07-r1".into(),
            effective_from: DateTime::parse_from_rfc3339("2026-08-01T00:00:00+05:30").unwrap(),
            author: "user_maker@tenant".into(),
            approver: "user_checker@tenant".into(),
        },
        models: vec![model("lending.eligibility")],
    }
}

fn signing_key() -> SigningKey {
    // Fixed test key; production keys live in KMS/HSM (SEC-2).
    SigningKey::from_bytes(&[7u8; 32])
}

#[test]
fn sign_then_verify_round_trips() {
    let key = signing_key();
    let signed = sign(bundle(), &key).unwrap();
    assert!(signed.hash.starts_with("sha256:"));
    assert_eq!(signed.hash, content_hash(&bundle()).unwrap());
    let verified = verify(&signed, &key.verifying_key()).unwrap();
    assert_eq!(verified, bundle());
}

#[test]
fn inv3_tampered_content_is_rejected() {
    let key = signing_key();
    let mut signed = sign(bundle(), &key).unwrap();
    // An attacker swaps a model after signing.
    signed.bundle.models[0].key = "lending.tampered".into();
    assert_eq!(
        verify(&signed, &key.verifying_key()).unwrap_err(),
        BundleError::HashMismatch
    );
    // A cleverer attacker recomputes the hash too — the signature catches it.
    signed.hash = content_hash(&signed.bundle).unwrap();
    assert_eq!(
        verify(&signed, &key.verifying_key()).unwrap_err(),
        BundleError::BadSignature
    );
}

#[test]
fn inv3_wrong_key_is_rejected() {
    let signed = sign(bundle(), &signing_key()).unwrap();
    let other = SigningKey::from_bytes(&[9u8; 32]);
    assert_eq!(
        verify(&signed, &other.verifying_key()).unwrap_err(),
        BundleError::BadSignature
    );
}

#[test]
fn inv9_same_author_and_approver_cannot_be_signed() {
    let mut b = bundle();
    b.manifest.approver = b.manifest.author.clone();
    assert_eq!(
        sign(b, &signing_key()).unwrap_err(),
        BundleError::FourEyesViolation
    );
}

#[test]
fn tenant_pack_with_guardrail_model_is_rejected() {
    // DEC-6 static leg: tenants cannot author platform guardrails.
    let mut b = bundle();
    b.models.push(model("guardrail.lending_floor"));
    assert_eq!(
        sign(b, &signing_key()).unwrap_err(),
        BundleError::TenantGuardrailModel
    );
}

#[test]
fn platform_pack_may_carry_guardrail_models() {
    let mut b = bundle();
    b.manifest.kind = BundleKind::Platform;
    b.manifest.tenant_id = None;
    b.models = vec![model("guardrail.lending_floor")];
    assert!(sign(b, &signing_key()).is_ok());
}

#[test]
fn non_ist_effective_date_is_rejected() {
    // INV-12: tenant-facing effective dates are IST.
    let mut b = bundle();
    b.manifest.effective_from = DateTime::parse_from_rfc3339("2026-08-01T00:00:00+00:00").unwrap();
    assert_eq!(sign(b, &signing_key()).unwrap_err(), BundleError::NotIst);
}

#[test]
fn canonical_bytes_are_stable() {
    // DEC-9: same content, same bytes, every time.
    assert_eq!(
        canonical_bytes(&bundle()).unwrap(),
        canonical_bytes(&bundle()).unwrap()
    );
}

#[test]
fn sec1_seal_and_open_round_trips_and_rejects_tampering() {
    let signed = sign(bundle(), &signing_key()).unwrap();
    let key = [42u8; 32];
    let nonce = [1u8; 12];
    let sealed = seal(&signed, &key, &nonce).unwrap();
    assert_eq!(open(&sealed, &key).unwrap(), signed);

    // Wrong tenant key: no cross-tenant reads (SEC-1, INV-2 at rest).
    assert_eq!(
        open(&sealed, &[43u8; 32]).unwrap_err(),
        BundleError::DecryptFailed
    );

    // Flipped ciphertext bit: AEAD integrity failure.
    let mut tampered = sealed.clone();
    tampered.ciphertext[0] ^= 0x01;
    assert_eq!(
        open(&tampered, &key).unwrap_err(),
        BundleError::DecryptFailed
    );
}
