# LoanOS Operations Documentation

Operator runbooks in this section are for controlled environments. They do not
replace production architecture, security, compliance, recovery, or change
management controls. The three showcase documents deliberately separate the
technical contract, the command-level runbook, and demo-day operation:

- [AWS synthetic showcase architecture](../architecture/aws-showcase-deployment.md)
  — canonical release boundary, resource ownership, update/rollback state
  machine, domain topology, security assumptions, and production gaps.

- [Synthetic demo operator handbook](demo-handbook.md) — prepare, present,
  update, troubleshoot, and retire the complete LoanOS showcase and customer
  workshop environments.
- [AWS synthetic demo deployment](../../deploy/aws/README.md) — infrastructure
  and host-level command procedure for the disposable AWS topology.
- [Observability operations](../architecture/observability-operations.md)
- [Recovery operations](../architecture/recovery-operations.md)
- [Release, configuration, and resilience operations](../architecture/delivery-operations.md)
- [Service operations and vendor oversight](../architecture/service-operations.md)
