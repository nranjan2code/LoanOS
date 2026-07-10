# LoanOS India - Seed Users & Credentials Reference

This document provides a complete guide to all pre-seeded platform admin users, tenant bank staff members, and customer profiles generated during the initial bootstrapping of the local development environment.

---

## 1. Platform Administration

Platform-level admin credentials are used to access control-plane routes (such as tenant onboarding, tenant offboarding, break-glass generation, and sub-processor management).

* **Login Endpoint**: `/auth/login`
* **Request Scope**: `platform`
* **Default Platform Admin User**:
  * **Email**: `admin@platform.local`
  * **Password**: `platform-admin-password` *(customizable via the `LOANOS_PLATFORM_ADMIN_PASSWORD` env variable)*
  * **Roles**: `["platform_admin", "tenant_provisioner", "security_admin", "auditor"]`
* **API Key Access**:
  * Pass the header `x-platform-admin-key: platform-secret-key` to bypass user-login session checks.

---

## 2. Bank Staff Users (Demo Tenant: `dev`)

These accounts are used to log in as different members of the bank organization to evaluate underwriting, maker-checker steps, disbursal checks, collections, and grievance redressals.

* **Login Endpoint**: `/auth/login`
* **Request Scope**: `tenant`
* **Tenant ID**: `dev`
* **Default Password**: `dev-admin-password` *(customizable via the `LOANOS_DEV_ADMIN_PASSWORD` env variable)*
* **Tenant API Key Access**:
  * Pass the header `x-api-key: dev-secret-key` to make raw service-level API requests.

### Pre-Seeded Bank Staff Members

| User ID | Email | Display Name | Staff Roles | Queue Subscriptions | Admin Roles |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`tenant_admin_1`** | `admin@dev.local` | Dev Tenant Admin | `workflow_admin` | `*` | `tenant_admin`, `user_admin`, `security_admin`, `auditor` |
| **`credit_maker_1`** | `credit-maker-1@dev.local` | Credit Maker | `credit_officer` | `credit_ops` | *None* |
| **`credit_checker_1`** | `credit-checker-1@dev.local` | Credit Checker | `credit_checker` | `credit_checker` | *None* |
| **`credit_lead_1`** | `credit-lead-1@dev.local` | Credit Lead | `workflow_admin` | `*` | *None* |
| **`credit_reviewer_1`** | `credit-reviewer-1@dev.local` | Credit Human Reviewer | `human_reviewer` | `model_risk` | *None* |
| **`loan_officer_1`** | `loan-officer-1@dev.local` | Loan Officer | `loan_officer` | `loan_ops` | *None* |
| **`disbursement_maker_1`** | `disbursement-maker-1@dev.local` | Disbursement Maker | `disbursement_maker` | `disbursement_ops` | *None* |
| **`compliance_analyst_1`** | `compliance-analyst-1@dev.local` | Compliance Analyst | `compliance_analyst` | `compliance_ops` | *None* |
| **`collections_manager_1`** | `collections-manager-1@dev.local` | Collections Manager | `collections_manager` | `collections_ops` | *None* |
| **`collections_lead_1`** | `collections-lead-1@dev.local` | Collections Lead | `workflow_admin` | `*` | *None* |
| **`portfolio_risk_1`** | `portfolio-risk-1@dev.local` | Portfolio Risk Manager | `portfolio_risk_manager` | `risk_ops` | *None* |
| **`grievance_officer_1`** | `grievance-officer-1@dev.local` | Grievance Officer | `grievance_officer` | `grievance_ops` | *None* |
| **`grievance_lead_1`** | `grievance-lead-1@dev.local` | Grievance Lead | `workflow_admin` | `*` | *None* |
| **`kyc_officer_1`** | `kyc-officer-1@dev.local` | KYC Officer | `kyc_officer` | `kyc_ops` | *None* |

---

## 3. Customer/Borrower Profiles (Demo Tenant: `dev`)

These profiles represent pre-seeded borrower records pre-linked to the pre-seeded Regulated Entity (`re_1` - India Retail Lending Corp) and Product Policy (`prod_1` - `RETAIL_PERSONAL_LOAN` in INR).

| Borrower ID | Name | Email | Residency | Occupation | Monthly Income | KYC Status | Consent Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`borrower_1`** | Rajesh Kumar | `rajesh@example.com` | India (`IN`) | Salaried | ₹45,000 | Verified (Medium Risk) | Accepted |
| **`borrower_2`** | Asha Sharma | `asha@example.in` | India (`IN`) | Self-Employed | ₹85,000 | Verified (Low Risk) | Accepted |
| **`borrower_3`** | Amit Patel | `amit@example.com` | India (`IN`) | Student | ₹12,000 | Verified (Low Risk) | Accepted |

---

## 4. Authentication Examples

### Platform Login Request
```bash
curl -i -X POST http://localhost:3040/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "platform",
    "email": "admin@platform.local",
    "password": "platform-admin-password"
  }'
```

### Tenant User Login Request
```bash
curl -i -X POST http://localhost:3040/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "tenant",
    "tenantId": "dev",
    "email": "loan-officer-1@dev.local",
    "password": "dev-admin-password"
  }'
```
