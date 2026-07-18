# Product Journey Support Matrix

This is the public-claim source of truth for the 21 product journeys shown on the LoanOS website. A page existing is not evidence that a journey is production-ready. LoanOS is multi-tenant SaaS: platform support and each tenant's activation are assessed separately.

Support levels are `planned`, `orchestration_only`, `configurable_pattern`, `controlled_first_slice`, and `production_ready`. Tenant activation additionally requires an approved journey configuration, regulated-entity and product-policy bindings, operating owners, tenant UAT, and live-provider readiness where applicable.

The platform persists maker-checker support certification, governed suspension, and independently approved provider, deployment and institution evidence registries. External artifact intake retains metadata/checksum, source, India immutable custody, witness and expiry only; it rejects payloads and requires a reviewer independent of proposer, producer and witness. Evidence bundles accept reviewed artifact identifiers only, and artifact suspension/expiry blocks later resolution. The production-assessment contract requires eleven current evidence domains and every provider family declared by the exact template/configuration version. Production proposals accept registry identifiers only; request-body evidence/provider claims are rejected, and approval plus live activation re-resolve current records. These repository attestations do not upgrade this matrix by themselves: real external and institution-witnessed evidence is still required.

The JD-05 local browser harness adds synthetic interactive evidence across every canonical capture workspace, including restrictive validation and recovery. It is not cross-browser/device certification, does not operate the full specialist/composed lifecycle, and does not change any support level in this matrix.

| Public journey | Platform support | Implemented system boundary | Remaining before production-ready |
| --- | --- | --- | --- |
| Personal loan | Controlled first slice | Connected LOS, underwriting, KFS, contracting, disbursement, LMS and servicing tests | Tenant policy/UAT and live providers |
| Co-lending programme | Controlled first slice | Arrangement, allocation, entity accounting, escrow settlement and reconciliation | Partner certification and tenant operating evidence |
| MSME working capital | Controlled first slice | Revolving limit, draw, interest, repayment, review and accounting | Tenant borrowing-base policy and integrations |
| MSME term loan | Configurable pattern | Common term-loan lifecycle plus tenant journey administration | Product-specific tenant UAT |
| Professional practice loan | Configurable pattern | Registration, practice cash flow, purpose and asset gates | Institution policy and end-to-end tenant evidence |
| Secured business loan | Configurable pattern | Collateral, title, valuation, insurance, perfection and release gates | Asset/provider certification and tenant UAT |
| Loan against property | Configurable pattern | Property/title/valuation/stage/security controls | State/product policy and certified providers |
| Home loan | Configurable pattern | Property, construction-stage, title and disbursement gates | Developer/project administration and tenant E2E |
| Equipment & machinery finance | Configurable pattern | Supplier, invoice, serial, installation, collateral and staged payment gates | Vendor integration and tenant E2E |
| Green equipment finance | Configurable pattern | Equipment controls plus green-taxonomy evidence gate | Approved taxonomy/incentive/reporting configuration |
| Personal vehicle loan | Configurable pattern | Dealer, vehicle, registration, insurance and payment gates | Vehicle registry/provider integration and tenant E2E |
| Commercial vehicle finance | Configurable pattern | Vehicle/dealer/registration/permit and cash-flow gates | Fleet/permit integrations and tenant E2E |
| Gold loan | Configurable pattern | Assay, purity, exact weight, packet, custody, LTV and auction-policy gates | Branch devices/custody integration and witnessed operations |
| Education loan | Configurable pattern | Institution/course/admission, co-borrower, moratorium and stage gates | Institution validation and tenant E2E |
| Agriculture & allied finance | Configurable pattern | Land/activity/crop/season/cash-flow/weather-price evidence gates | Live land/weather/market/programme data and tenant E2E |
| Microfinance & group lending | Configurable pattern | Group/household indebtedness, field evidence and conduct gates | Group meeting/offline field operation and tenant E2E |
| Consumer durable finance | Configurable pattern | Merchant, SKU, invoice, affordability and supplier-payment gates | POS/merchant integration and tenant E2E |
| Invoice discounting | Configurable pattern | Buyer/invoice/assignment, limit/concentration, draw and proceeds controls | Buyer/ERP verification and tenant E2E |
| Purchase-order finance | Configurable pattern | Buyer/PO, milestone, supplier release and settlement controls | Order/fulfilment integration and tenant E2E |
| Supply-chain finance | Configurable pattern | Anchor/participant, programme limit, transaction, funding and settlement controls | Anchor ERP/portal integration and tenant E2E |
| Trade-finance workflow | Configurable pattern | Counterparty/document/shipment/release/proceeds workflow controls | Instrument-specific banking messages, sanctions/trade data and tenant E2E |

No journey is labelled `production_ready` in the repository. That status is deliberately deployment-specific and expires unless the adopting tenant retains current operational, security, DR and external-provider evidence.
