# Platform module integration and API map

Status: complete-system target map, 15 July 2026.

This document answers **where every external API is needed across LoanOS**. It complements the [vendor procurement catalogue](integration-vendor-procurement-catalog.md), which answers who may supply it, its mock maturity and its commercial unit. “API” includes synchronous calls, callbacks, signed files/SFTP, portals and managed-service control APIs; it does not imply that a regulator offers public REST endpoints.

## Status and contract legend

| Value | Meaning |
| --- | --- |
| `Bound/Mock` | A callable mock-or-real boundary exists, but production certification or mock depth remains. |
| `Internal only` | LoanOS has the domain workflow/evidence, but no executable external adapter. |
| `Missing` | Neither a complete adapter nor a production-grade simulator exists. |
| `Live capable` | A real technical driver exists, although production topology may remain external. |
| `OUT` / `IN` / `BOTH` | LoanOS calls outward / receives callback or file / does both. |

Every `BOTH` integration requires idempotent commands, status/read, authenticated callbacks, replay protection and daily reconciliation. Every file integration requires a schema version, encryption/signature, manifest checksum, control totals, row results and correction lineage.

## Module coverage summary

| Platform area | Primary integration families | What blocks production |
| --- | --- | --- |
| Customer channels and CRM | identity, OTP/comms, DigiLocker, DMS, CRM, partner/branch, language | Delivery callbacks, external CRM/DMS, device/offline and consent-certified journeys |
| LOS | KYC/CKYC/V-CIP, bureau, AA, income/KYB, fraud, documents/eSign, collateral, bank verification, disbursement | Provider-native schemas, adverse mocks, memberships, signed artefacts and certified rails |
| Decision/risk/AML | bureau, AA/BSA, AML lists, fraud/device, feature and reference feeds | Live list/delta/data feeds, provenance and provider reconciliation |
| LWS | HRMS/IdP, communications, DMS, vendor panels, complaints, courts/regulators | Workforce sync, dispatch/delivery, binary evidence, workers and external statuses |
| LMS | CBS/GL, NACH/UPI, bank statements, communications, CIC, tax, insurance/collateral | Live collection/bank feeds, certified posting, notices and acknowledgements |
| Collections and recovery | dialer, field/MDM, payments, agencies, courts, CERSAI, valuation/custody/auction | Dialer/field/court/auction/custody adapters and signed payment callbacks |
| Finance and accounting | CBS/GL, bank/escrow, co-lender, GSTN/TDS, reconciliation | Incumbent mappings, signed transport, bank statements and tax filing |
| Compliance/reporting | CKYCRR, CIC, FIU, CERSAI, CRILC/CIMS/XBRL/PSL/DLA, RBI CMS | Institutional onboarding, schemas, signing keys, transport and portal acknowledgements |
| Partner/LSP | onboarding/KYB, CRM, commissions, tax, bank payouts, SLA telemetry | Partner identity/feeds, GST/bank/CBS integration and live telemetry |
| Enterprise platform/data | IdP/SCIM, KMS/HSM, SIEM/WORM/time, DB, queue, CDC/DW/BI, deploy, MDM | Most are governance attestations, not managed-service adapters |
| SaaS organisation admission and tenant lifecycle | contact verification, legal/RE status, representative authority, domain control, abuse defence, contracting, billing and cloud provisioning | Direct-authority ingestion, production verification/delivery adapters, signed contracts, cloud/DNS/certificate controllers and re-verification feeds |

## 1. Customer channels, CRM and assisted acquisition

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-CUS-01 | Registration and contact verification | SMS/email/WhatsApp OTP send/validate, DLT/template/sender sync, delivery and opt-out | BOTH; accepted → delivered/read/failed/bounced | Bound/Mock; persistent signed delivery API, reconciliation and shared retry/DLQ queue complete; live sync/dispatcher pending | LOS, LMS, LWS, collections |
| INT-CUS-02 | Lead capture and dedupe | CRM lead/party/activity/case upsert/search, attribution, merge event and delta | BOTH; source event/version, merge lineage | Internal only | LOS, partner |
| INT-CUS-03 | Branch/partner acquisition | Agent/branch/territory/credential/capacity master sync | BOTH; change/revoke and control totals | Internal only | LWS, partner |
| INT-CUS-04 | Document collection | DMS/object upload, malware/DLP/OCR, download/version, hold and deletion proof | BOTH; content hash, scan callback, manifest | Internal only | LOS, LMS, LWS, compliance |
| INT-CUS-05 | Government documents | DigiLocker consent, issuer/document discovery, fetch, URI/version and revocation | BOTH; consent and signed evidence | Missing | LOS |
| INT-CUS-06 | Mobile/field channel | MDM enrol/attest/compliance/wipe; device certificate/key lifecycle | BOTH; posture and wipe callbacks | Missing | LWS, collections |
| INT-CUS-07 | Offline field work | Encrypted work-pack lease/download; mutation/media replay/conflict/expiry | BOTH; checkpoint and reconciliation | Internal envelope controls | LWS, collections |
| INT-CUS-08 | Language/accessibility | Approved translation/content import; optional TTS/relay services | IN/BOTH; version/checksum/approval | Internal only | All notices |

## 2. LOS — origination, underwriting, contracting and disbursement

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-LOS-01 | Applicant identity | PAN verify/name/DOB/status; permitted Aadhaar offline/QR/KUA | OUT/BOTH; consent, source, match and correction | Missing native adapter | AML, partner |
| INT-LOS-02 | KYC reuse/registration | CKYC search, OTP download, upload/update, probable match, reject repair | BOTH/file; KIN/version and row results | Bound/Mock packets; direct registry local | Compliance |
| INT-LOS-03 | Remote KYC | V-CIP create/assign/session/recording, liveness/face/spoof/geo, sign-off | BOTH; states, signed report and custody | Bound/Mock; fixed success | AML |
| INT-LOS-04 | Business/KYB | GSTIN/Udyam/MCA/director/UBO/professional licence verification | OUT/BOTH; status, filings and correction | Missing | Risk, partner |
| INT-LOS-05 | Income/employment | EPFO/employer/email/ITR/GST fetch and income/cash-flow evidence | OUT/BOTH; periods, confidence, correction | Missing | Risk |
| INT-LOS-06 | Credit underwriting | CIBIL/Experian/Equifax/CRIF enquiry, score/report, no-hit, dispute | OUT/BOTH; purpose, enquiry ref, XML/PDF/hash | Bound/Mock; generic score | Risk, pricing |
| INT-LOS-07 | Open finance | AA consent/discovery/link/FI request/encrypted fetch/revoke; FIP failure | BOTH; signed consent, session, crypto validation | Bound/Mock; ref/count/hash | Risk, fraud, LMS |
| INT-LOS-08 | Statement assessment | Upload/parse, tamper, categorisation, income/obligation metrics | BOTH; model/rule version and correction | Missing | Risk |
| INT-LOS-09 | AML/fraud preflight | Sanctions/PEP/adverse media/negative list; device/SIM/IP/contact/account risk | BOTH; list/model version, reason, feedback | Certified adapter ports, adverse packs and reconciliation API complete; vendor feeds/payloads missing | AML, TM |
| INT-LOS-10 | Document extraction | OCR, authenticity/tamper, face-to-ID and manual-review outcome | BOTH; field confidence/reason/correction | Missing | Channels |
| INT-LOS-11 | Contract execution | eSign envelope/auth, eStamp, states, signed PDF, certificate/OCSP, cancel | BOTH; audit trail and checksum | Bound/Mock; no certificate lifecycle | LMS vault |
| INT-LOS-12 | Bank verification | Penny-less/drop validation, name score, account status and reversal | BOTH; verification ref/status | Bound/Mock; synchronous fixed records | Disbursement |
| INT-LOS-13 | Secured due diligence | Registry search, valuation/legal order and insurance quote | BOTH; reports, registry evidence, revisions | CERSAI partial; rest missing | Collateral/recovery |
| INT-LOS-14 | Security perfection | Registry/lien create-amend-release, insurance bind, custody intake | BOTH/file; acknowledgement/certificate | CERSAI partial; rest missing | LMS, recovery |
| INT-LOS-15 | Disbursement | Beneficiary validation; NEFT/RTGS/IMPS/payout; split/direct payment; reversal | BOTH; UTR/ref and settlement | Bank verify only; payout missing | Finance, LMS |
| INT-LOS-16 | Co-lending funding | Partner acceptance/allocation and escrow funding instruction | BOTH/file; exact paise/checksum/entity | Escrow Bound/Mock | Finance, partner |
| INT-LOS-17 | Customer delivery | KFS/sanction/agreement/privacy dispatch and proof of delivery | BOTH; template version/delivery | Communications Bound/Mock | LWS, audit |

## 3. Decision engine, risk, AML and fraud

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-RSK-01 | Eligibility/pricing facts | Versioned bureau, AA/BSA, income, GST and collateral facts | IN; source/time/version/checksum | Sources mostly mock/missing | LOS |
| INT-RSK-02 | Screening/CDD | Sanctions/PEP/adverse-media full/delta, revoke and rescreen | BOTH/file; signed manifest/count/checksum | Internal list registration | LOS, compliance |
| INT-RSK-03 | Transaction monitoring | Transaction feed, alert/case feedback and mule/network enrichment | BOTH; event, rule/model and disposition | Internal evaluation | LMS, compliance |
| INT-RSK-04 | Fraud intelligence | Device/identity/payment consortium lookup and confirmed-fraud feedback | BOTH; purpose and reason codes | Missing | LOS, collections |
| INT-RSK-05 | Model operations | Registry/artifact/feature feed, drift/bias metrics and kill-switch event | BOTH; artifact/data lineage | Internal governance | Platform, compliance |
| INT-RSK-06 | Reference data | Benchmarks, rates, calendars, geography, industry, collateral indices | IN/file; effective date/version/checksum | Institution-supplied data | LOS, LMS, ALM |

The deterministic rules engine never calls an external system during evaluation. Provider results enter as provenance-tagged facts before evaluation; failure produces refer/deny.

## 4. LWS — work management and control operations

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-LWS-01 | Staff authority/routing | HRMS worker/position/manager/branch/leave/delegation and JML delta | BOTH/file; version and active reconciliation | Missing | Platform IAM |
| INT-LWS-02 | Authentication/provisioning | OIDC discovery/auth-code/S256-PKCE/token/JWKS or certified SAML gateway; SCIM user/group provision/deprovision; MFA/WebAuthn/device posture | BOTH; signed identity/idempotent events | Protocol runtime, scoped SCIM, explicit session revocation, directory reconciliation, rotation/recovery controls and simulator conformance executable; no commercial IdP/MDM/gateway | Platform |
| INT-LWS-03 | Task/escalation | Email/SMS/WhatsApp/voice/pager and delivery callbacks | BOTH; task ref/status | Communication mocks | All modules |
| INT-LWS-04 | Evidence/committees | DMS upload/version/download, hold, signed minutes and manifest | BOTH; checksum/retention | Governance only | Audit/compliance |
| INT-LWS-05 | External work orders | Valuer/advocate/agency/custodian/insurer order/status/report | BOTH; certification/SLA events | Certified adapter ports, request/event lifecycle and reconciliation API complete; vendor mappings missing | LOS, recovery |
| INT-LWS-06 | Complaints/Ombudsman | Complaint intake/export, RBI CMS reference/status/closure evidence | BOTH/file/portal; correlation/ack | Internal only | Compliance |
| INT-LWS-07 | Court/regulator tasks | Filing accepted/rejected, hearing/order, response and due date | IN/BOTH; signed/portal evidence | Missing | Recovery, compliance |
| INT-LWS-08 | Workflow workers | Timer, queue/event bus, retry/DLQ, replay and webhook delivery | BOTH; offset/checkpoint/idempotency | Persistent callback delivery queue, lease/retry/DLQ/four-eyes replay API complete; scheduled background/broker workers pending | Whole platform |

## 5. LMS — boarding, servicing, collection and closure

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-LMS-01 | Account boarding/posting | CBS customer/facility sync; GL submit/ack/reject/reverse; totals | BOTH/file | CBS checksum mock; GL transport missing | Finance |
| INT-LMS-02 | Mandates | NACH/eNACH create/amend/cancel/status and UMRN | BOTH/file; sponsor/NPCI acknowledgement | Bound/Mock; immediate registration | LOS, succession |
| INT-LMS-03 | Scheduled collection | NACH presentment/return; UPI collect/status/expiry; recurring instruction | BOTH/file; return/reversal/settlement | Bound/Mock; no lifecycle driver | Collections, finance |
| INT-LMS-04 | Receipt/reconciliation | Rail callback/file, bank statement, UTR match and reversal | IN/file; signed event/totals/exceptions | Timestamp-bound HMAC API, replay fingerprint and linked return/reversal complete; live certification/file signatures pending | Finance |
| INT-LMS-05 | Refunds/payouts | Cooling-off/excess/failed-disbursement refund and reversal | BOTH; exact amount, UTR, settlement | Missing | LOS, finance |
| INT-LMS-06 | Servicing notices | EMI/rate/schedule/penal/statement/closure notifications | BOTH; template/delivery evidence | Acceptance-only mock | LWS, complaints |
| INT-LMS-07 | Statements/vault | DMS render/store/version/download, hold and deletion | BOTH; document/manifest hashes | Local metadata; DMS missing | Channels, compliance |
| INT-LMS-08 | Credit furnishing | CIC batch/API, row reject, correction/resubmit and acknowledgement | BOTH/file | Internal lifecycle; transport mock | Compliance |
| INT-LMS-09 | Ongoing KYC/risk | CKYC/identity refresh, AA re-consent, bureau review, AML rescreen | BOTH | Partial | Risk/compliance |
| INT-LMS-10 | Insurance/collateral | Renewal/lapse/claim, valuation/inspection, registry/covenant status | BOTH | Missing except CERSAI | Collateral/recovery |
| INT-LMS-11 | Restructure/transfer | CBS/GL, mandate, partner/assignee instruction and completion | BOTH/file | Internal lifecycle; external partial | Finance |
| INT-LMS-12 | Closure/release | Mandate cancel, lien/registry release, custody return, NOC delivery | BOTH/file | Internal controls; adapters missing | Recovery/compliance |

## 6. Collections, field and legal recovery

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-COL-01 | Tele-collections | Dialer campaign/list, click-to-call/IVR, disposition, recording, DNC | BOTH; attempt/recording completeness | Dialer/IVR adapter port and adverse contract complete; live vendor mapping missing | LWS |
| INT-COL-02 | Digital collection | UPI/link/NACH retry, status, settlement, return, reversal and receipt | BOTH | Payment boundary partial | LMS, finance |
| INT-COL-03 | Field assignment | Agency/agent cert, route, visit, geo/photo/receipt/offline sync | BOTH; device binding/media manifest | Field adapter port and adverse request/event contract complete; live platform mapping missing | LWS, MDM |
| INT-COL-04 | Agency oversight | Roster/capacity, conduct, SLA, invoice and outcome feed | BOTH/file | Internal governance | Partner, finance |
| INT-COL-05 | Legal cases | Advocate assign, filing/upload, eCourts/cause-list/hearing/order | BOTH/file/portal | Internal lifecycle; adapter missing | LWS |
| INT-COL-06 | Security enforcement | CERSAI, notice delivery, possession, valuer/custodian/yard order | BOTH/file | CERSAI partial; rest missing | Collateral |
| INT-COL-07 | Auction | Publish, bidder KYC/deposit, bid register, winner/payment/default/certificate | BOTH/file | Missing | Finance, legal |
| INT-COL-08 | Recovery proceeds | Payment/escrow/bank, expense invoice, surplus/refund and GL | BOTH/file | Internal accounting; feeds incomplete | LMS, finance |

## 7. Collateral, insurance, legal and custody

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-COLAT-01 | Asset verification | Land/title/encumbrance, VAHAN/RC, MCA, depository/lien, invoice | OUT/BOTH | Missing | LOS, recovery |
| INT-COLAT-02 | Valuation | Panel sync, work order, inspection, comparables, report/revision/SLA | BOTH | Missing | LOS, LMS, recovery |
| INT-COLAT-03 | Legal/title | Advocate cert/conflict, search order, signed opinion and correction | BOTH | Missing | LOS, recovery |
| INT-COLAT-04 | Security registry | CERSAI/ROC/state/RTO/depository create/amend/release/certificate | BOTH/file | CERSAI Bound/Mock; rest missing | LOS, LMS, compliance |
| INT-COLAT-05 | Insurance | Quote/bind/premium/endorse/renew/lapse/cancel/claim/document | BOTH/file | Missing | LOS, LMS, finance |
| INT-COLAT-06 | Custody | Intake/inventory/movement/count/hold/release/acknowledgement | BOTH/file | Evidence governance only | LOS, closure, recovery |
| INT-COLAT-07 | Repossession/yard | Work order, inventory/condition, movement, fees and release | BOTH/file | Internal workflow | Recovery, finance |

## 8. Finance, accounting, treasury and co-lending

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-FIN-01 | CBS/GL | Master/chart sync, journal, ack/reject, reversal, trial-balance totals | BOTH/file | CBS mock plus signed/encrypted exact-paise file conformance harness; binary/vendor transport missing | LOS, LMS |
| INT-FIN-02 | Bank reconciliation | Statement API or MT940/BAI/CSV, balance, UTR and totals | IN/file | Reconciliation exists; feed missing | LMS, payments |
| INT-FIN-03 | Rail settlement | Settlement, fees/tax, refund/chargeback/return, payout and invoices | IN/BOTH/file | Internal strong; callbacks incomplete | LMS, collections |
| INT-FIN-04 | Escrow/co-lender | Balance/statement, funding/settlement/split, invoice, partner GL and ack | BOTH/file | Exact mocks partial | LOS, partner |
| INT-FIN-05 | GST/e-invoice | GSTIN auth, IRN/invoice/credit, return/challan/reject/correct/ack | BOTH/file | Internal tax; live GSTN missing | Partner |
| INT-FIN-06 | TDS/Income Tax | Deduction/challan/return/correction/certificate and ack | BOTH/file | Internal evidence; adapter missing | Partner |
| INT-FIN-07 | Treasury/ALM | Bank balances, facilities, benchmark/yield/FX and maturity feeds | IN/file | Internal projections; feeds missing | Risk |
| INT-FIN-08 | Vendor/partner payables | ERP invoice, beneficiary validation, payout and reconciliation | BOTH/file | Partner finance partial | Partner, LWS |

## 9. Compliance, audit and regulatory reporting

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-REG-01 | CKYCRR | Upload/update, signed submit, accept/reject/probable match/repair | BOTH/file | Bound/Mock | LOS |
| INT-REG-02 | CIC furnishing | Submission, row reject, correction/resubmit and ack | BOTH/file | Bound/Mock; internal strong | LMS |
| INT-REG-03 | FIU-IND FINnet | STR/CTR XML/XSD validate/sign/submit/poll/repair/ack | BOTH/file/portal | Bound/Mock packet; cert missing | AML |
| INT-REG-04 | CERSAI | Search/file/amend/satisfy, fee, reject/correct/certificate | BOTH/file | Bound/Mock | Collateral |
| INT-REG-05 | RBI CRILC/SMA | Extract/validate/sign/transmit/ack/amend | BOTH/file/portal | Domain governance plus signed/encrypted row-level file conformance harness; transport missing | LMS, risk |
| INT-REG-06 | CIMS/XBRL/PSL/DLA | Taxonomy sync, generate/validate/sign/submit/reject/ack | BOTH/file/portal | DLA export plus signed/encrypted CIMS/XBRL/PSL conformance harness; transport missing | Finance, platform |
| INT-REG-07 | Complaints/Ombudsman | RBI CMS reference/status/response pack/closure | BOTH/file/portal | Internal only | LWS |
| INT-REG-08 | Evidence anchoring | WORM/object-lock, hold, external timestamp/anchor and verify | BOTH | Attestation only | Platform security |
| INT-REG-09 | Regulatory change | Circular/legal update feed and obligation mapping evidence | IN | Manual register | Product/compliance |

Regulatory integration must be in the regulated entity’s name where required. A vendor API cannot replace membership, reporting responsibility, digital signatures or regulator credentials.

## 10. Partner, LSP, DLA and vendor ecosystem

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-PRT-01 | Partner onboarding | KYB/GSTIN/MCA/UBO, bank verification and contract eSign | BOTH | Components partial/missing | LOS, compliance |
| INT-PRT-02 | Lead/service exchange | Lead/application/status/document/consent and dedupe | BOTH | Local workflow; connector missing | Channels, LOS |
| INT-PRT-03 | Identity/entitlements | Partner IdP/SCIM or user feed; territory/role/credential revoke | BOTH/file | Internal credentials only | LWS |
| INT-PRT-04 | Commission/invoice | Event/statement, GST/TDS, dispute, approval and correction | BOTH/file | Internal exact lifecycle | Finance |
| INT-PRT-05 | Settlement | Beneficiary validation, payout, UTR, failure/reversal and reconciliation | BOTH/file | Bank-file representation | Finance |
| INT-PRT-06 | Oversight/SLA | Incident/complaint/conduct/capacity/exit telemetry and evidence | BOTH/file | Internal governance | LWS, platform |

## 11. Enterprise platform, security, data and operations

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-PLT-01 | Workforce identity | Entra/Okta/AD FS/Keycloak/OpenLDAP-bridge or generic OIDC/SAML metadata/JWKS/signatures, MFA/WebAuthn/device posture, SCIM JML, group-to-role request, logout/token revoke and access-review export | BOTH | Cryptographic OIDC, certified SAML-attestation boundary, scoped SCIM with explicit session revocation, rotation/recovery/reconciliation and exhaustive simulated conformance executable; no commercial connection. IdP groups never grant canonical roles directly | LWS, admin, isolated control engine |
| INT-PLT-02 | Secrets/crypto | Vault lease/revoke; KMS/HSM encrypt/sign/rotate/destroy | BOTH | Attestation; local/env keys | Every adapter |
| INT-PLT-03 | Security monitoring | Attributed API/UI/domain/decision/integration events, correlation propagation, SIEM ingest, completeness reconciliation, alert/SOAR, DLP/scanner and threat intelligence | BOTH | Authenticated API/UI activity, export custody reconciliation and mandatory simulated SIEM adverse pack exist; external collectors and live cross-system correlation remain missing | Compliance |
| INT-PLT-04 | Evidence/time | WORM/object lock, hold/deletion, trusted NTP/TSA/anchor | BOTH | Exact custody contract and simulated adverse pack; no live WORM/time provider | Audit |
| INT-PLT-05 | Database | Managed PostgreSQL HA/replica/PITR/restore/failover/telemetry | BOTH | Live-capable pg; control API absent | Whole platform |
| INT-PLT-06 | Events/jobs | Queue/topic, scheduler, offsets, retry/DLQ and replay | BOTH | Persistent callback queue plus bounded HTTP dispatcher, circuit/health metrics complete; production scheduler/broker deployment pending | All modules |
| INT-PLT-07 | API management | Gateway, mTLS/OAuth, WAF/rate-limit, schemas and usage | BOTH | App controls; gateway missing | All APIs |
| INT-PLT-08 | Observability/support | Metrics/log/trace, synthetic, incident/on-call/ticket/SLA | BOTH | Internal ops; connectors missing | Vendors |
| INT-PLT-09 | CDC/warehouse/lake | Log CDC, schema, checkpoint/backfill, sink, DQ, lineage, marts | BOTH | Governance only | Finance, risk, reporting |
| INT-PLT-10 | BI | Dataset/semantic model/dashboard/export and row-level access | BOTH | Local dashboard; BI missing | Management |
| INT-PLT-11 | Deployment/supply chain | CI, artifact/sign/SBOM/scans, canary/promote/rollback/evidence | BOTH | Governance; controllers missing | Engineering |
| INT-PLT-12 | Tenant billing | Meter, invoice/tax, payment, credit/refund and accounting export | BOTH | Commercial controls only | Platform finance |
| INT-PLT-13 | Device management | MDM/attestation/certificates/wipe/app config | BOTH | Missing | Channels, collections |
| INT-PLT-14 | Portability/archive | Encrypted bulk export/import, manifest, receipt and deletion attestation | BOTH/file | Local export; external custody missing | Tenant lifecycle |

## 12. SaaS organisation admission, contracting and tenant lifecycle

These dependencies verify the prospective platform customer and safely create its tenant. They do **not** replace borrower KYC/CDD performed by the adopting regulated entity. A regulator or registry may provide a list, file or portal rather than a public API; the adapter must retain source/version/checksum evidence and fail closed when authority or status cannot be established.

| ID | Needed at | External operations | Direction / response | Current state | Also used by |
| --- | --- | --- | --- | --- | --- |
| INT-ADM-01 | Signup contact and invitations | Work-email and mobile OTP; invite/expiry; DLT/template; delivery, bounce, complaint and suppression | BOTH | Communication boundary is Bound/Mock; production signup deliberately denies mock delivery | Platform IAM, support |
| INT-ADM-02 | Legal-entity and tax identity | MCA company/LLP master, CIN/LLPIN, directors/signatories, GSTIN, PAN/TAN and Udyam status/change evidence | OUT/BOTH/file | Evidence references only; no admission-specific adapter | LOS KYB, partner onboarding |
| INT-ADM-03 | Regulated-entity authority | RBI/other-authority current and cancelled lists, licence/CoR category, layer, deposit permission and permitted activities | IN/OUT/file/portal | Applicant evidence plus manual review; no authoritative ingestion/monitor | Compliance, product eligibility |
| INT-ADM-04 | Representative authority and signature | Director/DIN/signatory match, board resolution, official-contact confirmation, DSC/eSign chain/CRL/OCSP and long-term validation evidence | BOTH/file | Representative proofs and checksums are local; live authority/signature validation missing | Contracting, IAM |
| INT-ADM-05 | Corporate domain and contact assurance | DNS TXT challenge, RDAP/WHOIS, MX/mailbox, domain age/reputation, website/official-contact corroboration and certificate challenge | BOTH | Caller-supplied domain evidence only; no DNS/RDAP/reputation adapter | Branding, federation |
| INT-ADM-06 | Signup abuse and fraud defence | WAF/rate-limit/bot challenge; IP, device, email, phone/SIM and velocity intelligence; confirmed-abuse feedback | BOTH | Local rate limits and submitted risk evidence; edge/bot/device providers missing | Customer acquisition, SOC |
| INT-ADM-07 | Contract and outsourcing due diligence | NDA/MSA/DPA/SLA/order form, eSign, questionnaire/evidence exchange, subprocessor/BCP/DR/exit approval and change callbacks | BOTH/file | Version/evidence references only; no DMS/eSign/GRC connector | Vendor risk, legal, compliance |
| INT-ADM-08 | Subscription, invoicing and tax | Plan/entitlement, meter, invoice/GST, payment, credit/refund, dunning and accounting export | BOTH/file | Commercial controls only; no billing/tax/payment provider | Finance, entitlements |
| INT-ADM-09 | Tenant infrastructure provisioning | Cloud/IAM, namespace/network, DNS/certificate, KMS, DB, queue, object/WORM, observability, backup/DR; status, compensation and rollback proof | BOTH | Dependency saga and injected execution ports exist; no cloud/DNS/certificate controllers | Deployment, security, data |
| INT-ADM-10 | Workforce federation and re-verification | OIDC/SAML/SCIM onboarding; domain/group proof; JML; licence/legal/domain/representative delta rescreen; case/ticket escalation | BOTH/file | Federation protocol runtime and SCIM surface implemented; live commercial IdP/MDM/registry/ticket feeds missing | LWS, platform operations |

## Cross-module dependency matrix

`P` is the primary owner; `C` is a consumer.

| Integration family | Channels | LOS | Risk | LWS | LMS | Collections | Collateral | Finance | Compliance | Partner | Platform |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Identity/KYC/CKYC/V-CIP | C | P | C | C | C | — | — | — | C | C | C |
| Bureau/AA/income/BSA | — | P | C | — | C | — | — | — | C | — | C |
| Fraud/AML/reference | C | C | P | C | C | C | — | — | C | C | C |
| Documents/OCR/eSign/eStamp | C | P | — | C | C | C | C | C | C | C | C |
| Communications/voice | P | C | — | C | C | C | — | C | C | C | C |
| Payments/NACH/payout/bank | C | C | C | — | P | C | — | C | C | C | C |
| Collateral/registry/insurance/custody | — | C | C | C | C | C | P | C | C | — | C |
| CBS/GL/tax/treasury/escrow | — | C | C | — | C | C | C | P | C | C | C |
| Regulatory submissions | — | C | C | C | C | C | C | C | P | C | C |
| HRMS/CRM/partner systems | C | C | — | C | — | C | — | C | C | P | C |
| IdP/KMS/SIEM/DB/queue/data/deploy | C | C | C | C | C | C | C | C | C | C | P |
| Organisation admission/licence/domain/provisioning | — | C | C | C | — | — | — | C | C | C | P |

## Completeness and change-control rule

The complete-system scope is covered only when every row has an owner, versioned adapter/data classification, deterministic adverse mock, vendor/direct-authority and commercial unit, sandbox/UAT and production certification, authenticated callbacks/files, reconciliation/monitoring/DR/exit evidence, and a tracked implementation status. Shared execution controls now include schema-checksum-bound vendor mappings, mTLS HTTPS and injected SFTP/portal clients, KMS/HSM/PGP ports, lease-fenced integration jobs, and a 13-scenario adverse UAT gate; module owners still provide the selected vendor's profile and external evidence.

When a feature introduces an external dependency, update this map first, then the procurement catalogue, complete-system capability catalogue, current implementation and backlog in the same change. No external call may be embedded directly in LOS/LMS/LWS domain logic; it must use a tenant-scoped adapter and fail closed.
