# Platform Admission and Organisation Verification Control Map

Status: implementation control map for LoanOS customer admission. It is not a legal opinion and does not convert a SaaS administrator into a borrower/customer under RBI KYC rules. The adopting regulated entity (RE), LoanOS compliance and counsel must confirm applicability for each contract and deployment.

## Regulatory posture

LoanOS is an IT service provider to Indian REs. The RBI's 2023 IT Outsourcing Directions place continuing accountability on the RE and require risk-based service-provider due diligence across financial, operational, legal, reputational, security, resilience, data-segregation, subcontracting and regulatory-access factors. LoanOS therefore must not let an unverified claimant obtain an RE-branded tenant, credentials or integrations; reciprocal customer verification also produces evidence the RE needs for its own outsourcing assessment. The RE remains responsible for the outsourced activity. Source: [RBI IT Outsourcing Directions, 2023](https://systemhealth.rbi.org.in/Scripts/BS_ViewMasDirections.aspx_id%3D12486.html).

The RBI IT Governance, Risk, Controls and Assurance Directions require governed IT/security accountability, risk-based assurance, access controls, auditability and resilience in applicable RE environments. Admission and privileged bootstrap access are part of that control boundary. Source: [RBI IT Governance, Risk, Controls and Assurance Directions, 2023](https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=12562).

RBI reporting has highlighted illegal digital lending apps and false claims of association with REs. Tenant admission must therefore prevent a claimant from publishing an RE identity, DLA or borrower-facing experience before the RE relationship and authority are verified. Source: [RBI Annual Report 2024-25, paragraphs VI.14 and VI.20](https://www.rbi.org.in/scripts/AnnualReportPublications.aspx?Id=1436).

Personal data collected from applicants must have a declared purpose, minimal fields, controlled retention, appropriate notice/consent or other lawful basis, security safeguards and enforceable erasure/retention outcomes under the applicable commencement schedule. Source: [Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa).

CERT-In's section 70B directions inform incident reporting, time synchronisation, log preservation and secure service operations. They do not by themselves make every LoanOS applicant subject to RBI customer KYC. Source: [CERT-In Directions under section 70B](https://cert-in.org.in/Directions70B.jsp).

## Admission policy

`signup` means an application for verification. It never creates an active tenant, production credential, public RE page, DLA association, borrower channel or live integration.

| ID | Gate | Minimum evidence | Outcome on failure |
| --- | --- | --- | --- |
| ADM-01 | Human contact | Verified corporate email and Indian mobile; bounded, hashed, single-use challenges | Expire or block application |
| ADM-02 | Person identity | Name and identity-verification provider evidence; no Aadhaar authentication secret/biometric stored | Manual EDD or reject |
| ADM-03 | Authorised representative | Board resolution, authority letter, DSC/EVC or independently confirmed corporate contact | Manual EDD; no owner grant |
| ADM-04 | Legal existence | CIN/LLPIN and legal name/status/registered-office match from MCA evidence | Block mismatch/inactive entity |
| ADM-05 | Tax identity | PAN and, where applicable, GSTIN legal-name/status match | Block material mismatch/cancelled registration |
| ADM-06 | RE authority | RE category, RBI/NHB/other authority, CoR/licence number/status and official-list evidence | Reject RE claim or admit only a non-production evaluation tenant |
| ADM-07 | Domain control | Corporate-domain DNS/file/mailbox proof plus match to official records | Manual EDD; public branding prohibited |
| ADM-08 | Relationship | Executed MSA/DPA/SLA/order form, approved deployment model and subscription | Remain contract-pending |
| ADM-09 | Outsourcing acceptance | Named RE sponsor, outsourcing owner, risk tier, audit/regulator access, subcontractor and exit acknowledgement | Remain governance-pending |
| ADM-10 | Abuse/fraud | IP/device/velocity/disposable-domain/risk signals, duplicate legal identifiers, deny lists and investigation reference | Cool-down, manual EDD or reject |
| ADM-11 | Sanctions/adverse risk | Entity/representative screening evidence where required by policy; false-positive review | Manual EDD or reject per policy |
| ADM-12 | Security bootstrap | Owner chooses credential, MFA completes, recovery contacts and second administrator/checker are invited | Restricted bootstrap only |
| ADM-13 | Provisioning | Approved deployment blueprint and completed tenant-scoped provisioning checkpoints | Never activate partially provisioned tenant |
| ADM-14 | Launch | Independent staffing/SoD, configuration, provider, finance, compliance, sandbox/UAT and handover evidence | Tenant remains non-production |

Official verification surfaces include MCA company/LLP master data ([MCA master-data guidance](https://www.mca.gov.in/Ministry/pdf/MCAV2Release2_Help.pdf)), GST taxpayer status ([GST Search Taxpayer guidance](https://tutorial.gst.gov.in/userguide/taxpayersdashboard/Search_Taxpayer_manual.htm)), PAN status ([Income Tax Department Verify PAN guidance](https://www.incometax.gov.in/iec/foportal/help/how-to-verify-pan?mobile-app=1)), and RBI regulated-bank/NBFC sources ([RBI sitemap and regulated-entity directories](https://www.rbi.org.in/Scripts/sitemap.aspx)). Production adapters must retain response provenance, observation time, schema/version and checksum; screenshots or applicant-uploaded certificates alone are insufficient for automated approval.

## Decision outcomes

- `pending_contact_verification`: no organisation claim is evaluated.
- `pending_organisation_verification`: contacts passed; registry/licence/authority checks outstanding.
- `enhanced_due_diligence`: ambiguity, elevated abuse risk or non-automatable evidence requires a trained reviewer.
- `verified_pending_contract`: identity and organisation passed; commercial/regulatory agreements outstanding.
- `verified_pending_provisioning`: contract and admission independently approved; provisioning may begin.
- `restricted_bootstrap`: owner may complete MFA, invite administrators and configure non-production resources only.
- `launch_pending`: infrastructure and configuration exist; independent UAT/handover not complete.
- `active`: all admission, provisioning, staffing and launch gates passed.
- `rejected`, `expired`, `cancelled`: terminal without tenant production access; appeal creates a linked review, not an in-place evidence rewrite.

## Mandatory operating controls

- Separate applicant, verifier, admission approver, provisioning operator and launch approver.
- Bind every observation to applicant, organisation, tenant candidate, source, timestamp and checksum.
- Do not expose whether an email, CIN, GSTIN or tenant already exists beyond a neutral response; require the separate case access secret rather than treating the opaque case identifier as authorisation.
- Encrypt applicant evidence; never log OTPs, passwords, private keys, identity document values or raw provider payloads.
- Rate-limit by account, IP, device, domain and legal identifier; preserve security events without creating an unlimited identity-document store.
- Reverify licence, legal status, authorised contacts, contracts and privileged access on risk-based schedules and material change.
- Suspend branding and production access on licence cancellation, impersonation, contract termination or unresolved high-risk change; preserve audit and exit obligations.
- Support false-positive review, reasoned rejection and independently reviewed appeal without disclosing detection rules.

## Regulatory boundary

Borrower KYC/CDD under the RBI KYC Directions remains an RE obligation and is implemented elsewhere in LoanOS. Platform admission uses identity and organisation verification to protect the SaaS control plane and substantiate the customer relationship. It must not be represented as completing the RE's borrower KYC, AML or outsourcing due diligence, nor as RBI approval of LoanOS.
