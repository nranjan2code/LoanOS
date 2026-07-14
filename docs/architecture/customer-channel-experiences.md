# Customer and Channel Experience Operations

## Purpose and maturity

This slice establishes a tenant-isolated operating boundary for branch-assisted and authorised-partner lead intake, customer-party relationships, accessibility preferences, succession handling, and a joined customer-360. It is an executable first slice, not a production-complete CRM or partner settlement system.

The implementation deliberately separates lead capture from credit approval. A channel user can capture, route, qualify, follow up, match, abandon, or link a converted lead to an already-created borrower/application. The channel cannot approve credit, promise pricing, move funds, or silently merge customers.

## Domain controls

| Control | Enforced behaviour |
| --- | --- |
| Partner authority | DSA, BC, connector, dealer, merchant, and LSP partners require active programme, operating-unit, PIN-code, agreement, due-diligence, conduct-policy, consent-training, and independent approval evidence. |
| Programme routing | A lead is accepted only when its active programme supports the channel and requested product, its partner is authorised for that programme/PIN, and an active programme unit services the PIN. Branch intake can be auto-routed or pinned to a serviceable unit. |
| Minimum intake | Name plus email or Indian mobile is required. Requested money is an integer-paise string. Source attribution, consent and disclosure references are mandatory; branch/partner intake also requires a conduct attestation. |
| Duplicate handling | Normalised contact hashes detect open leads; customer contacts detect known borrowers. A match enters `duplicate_review` and can only continue or close as duplicate with reason and evidence. No automatic customer merge occurs. |
| Lead lifecycle | State-specific transitions govern contact, qualification, follow-up, duplicate resolution, conversion, and abandonment. Every transition retains actor, reason, evidence, timestamp, and lineage checksum. Conversion requires existing borrower/application identifiers. |
| Commission policy | Approved policy records flat-paise or disbursed-amount basis points, exact payout cap, eligible event, tax reference, and clawback window. Calculation, accrual, invoice, tax withholding, settlement, and clawback execution remain future finance work. |
| Channel entitlement | Every tenant user carries an explicit `tenant`, `partner`, or `operating_unit` scope. Partner/unit projections contain only authorised programmes, partners, policies, assessments, and leads; customer-master collections are removed and out-of-scope mutations fail closed. Service credentials remain tenant-scoped integration identities. |
| Commission execution | A converted partner lead and the policy's eligible event produce an exact-paise assessed gross, cap, tax withholding and net payable. Independent approval precedes settlement; settlement requires payment and reconciliation evidence; clawback is limited to the approved window. |
| Party graph | Approved typed edges cover co-applicant, co-borrower, guarantor, household, group, JLG, connected party, nominee, legal heir, and authorised representative, including liability and evidence. |
| Merge governance | A four-eyes `approved_not_executed` plan identifies survivor, duplicates, match evidence, field-conflict choices, migration scope, and rollback evidence. Destructive merge execution is intentionally absent. |
| Customer intent | Preferred/communication language, vulnerability, accessibility, assisted-journey, do-not-contact, contact-window, consent, and recording actor are retained per borrower. |
| Succession | Deceased-borrower claims require an approved nominee/legal-heir/representative relationship plus death, identity, legal, and affected-loan evidence. Servicing stays `manual_review_only` until independently approved and completed. |
| Customer-360 | Profile, preferences, party graph, related applications/accounts, complaints, consents, documents and succession cases are joined. Related-party principal exposure is aggregated exactly in paise. |

## Access surfaces

- `GET /channels/operations` exposes the role-gated operational projection, including active programme choices but not product-policy internals.
- `/channels/partners`, `/channels/commission-policies`, `/channels/leads`, and lead transition endpoints persist governed channel records.
- `/customers/relationships`, `/customers/merge-plans`, `/customers/preferences`, and succession endpoints persist customer controls.
- `GET /customers/{borrowerId}/360` returns the joined tenant-local view.
- `/t/{tenantId}/partners/` serves the responsive branch/channel workspace. It uses tenant-user sessions, programme/product selectors, consent-led intake, matching review, evidence-bound actions, keyboard focus, reduced-motion support, and tenant branding.
- The workspace is installable as a PWA. Its service worker caches only the static application shell; API responses and customer/lead data are never cached. Offline state is explicit and mutations remain unavailable until reconnect.

All mutations append actor-attributed records to the tenant audit chain. API-key access remains an integration path; human channel operation uses institution-issued tenant-user sessions.

## Production boundaries and next work

The following remain before a bank can treat this as a complete channel/CRM system:

1. Add partner onboarding UI, credential lifecycle, field hierarchy, territory/capacity allocation, periodic access certification, and conduct-monitoring cases. Partner/unit row-level entitlement is now enforced in the application layer; production database policies and negative isolation tests remain required.
2. Implement conversion orchestration that creates or links a governed application without duplicating borrower identity.
3. Extend commission assessment/approval/settlement/clawback with invoice validation, GST/TDS documents, GL payable postings, bank-file generation, disputes, reversals and partner statements.
4. Execute customer merges transactionally across every governed object with dry run, conflict report, audit proof, rollback, and downstream identity reconciliation.
5. Add succession servicing actions, document/legal review queues, payment/communication authority changes, and account closure/transfer controls.
6. Add Indian-language content packs and institution-approved templates; storing language preference is not equivalent to translated content.
7. Complete assistive-technology testing, device/browser certification, field/offline encrypted work queues, and production PWA security review. Business data must never enter general browser caches.

## Test evidence

`tests/customer-channel-operations.test.js` covers partner authority, identity scope isolation, exact commission lifecycle, serviceability/product rejection, multi-channel matching, controlled lead lifecycle, party/merge/preferences, succession approval, exact related exposure, API persistence, customer-360, and the static/PWA surface. The wider suite protects tenancy, audit, money, origination, servicing, and integration boundaries.
