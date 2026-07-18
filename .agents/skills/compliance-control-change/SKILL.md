---
name: compliance-control-change
description: Use when changing a compliance or regulatory control or its interpretation — code under packages/core/src/compliance/ or the docs/compliance/ register, build checklist, or admission control map. Keeps controls grounded in official sources and fail-closed.
---

# Change a compliance control safely

Compliance behavior is a control with a regulatory anchor, not ordinary
feature code. The trap is changing enforcement (or its documented
interpretation) without updating the source-grounded register — the docs then
overstate or understate what the platform enforces, which is exactly what a
compliance-first product cannot afford.

## Workflow

1. Ground the change in an official source. The regulatory control families
   and their anchors live in `docs/compliance/india-regulatory-register.md`;
   organisation/representative admission controls in
   `docs/compliance/platform-admission-control-map.md`. If the source doesn't
   support the change, stop and raise it — do not encode an interpretation the
   register cannot cite.
2. Implement fail-closed: in the control and anything feeding it, error paths
   land on the restrictive outcome (`refer`/`deny`/`hold`), never a permissive
   default. This includes "service unreachable" (INV-5 discipline).
3. Update the compliance documentation set in the same change:
   - `docs/compliance/india-regulatory-register.md` if the control family or
     interpretation moved;
   - `docs/compliance/compliance-build-checklist.md` for build/production
     status of the control;
   - `docs/compliance/platform-admission-control-map.md` if admission is
     affected.
4. If a user-facing action or expectation changes, update the Guide control
   note (`update-guide-academy` skill). If the capability catalogue's maturity
   for this control moves, follow the `add-capability` skill — conservative by
   default.
5. Gate:
   ```bash
   npm test                  # the control's tests, including the adverse path
   npm run knowledge:check
   ```
   A control change without a test for its restrictive path is not done.

## Notes

- Compliance docs describe product controls and applicability research — they
  are not legal advice and never claim RBI certification. Keep that boundary
  in any wording you touch.
- If the change is externally visible (what Sales may claim), sweep the claim
  register (`update-gtm-claim` skill).
- An interpretation choice that is expensive to reverse is ADR territory
  (`record-adr` skill).
