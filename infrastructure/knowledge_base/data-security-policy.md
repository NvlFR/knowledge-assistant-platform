# SOP: Internal Data Security Policy

## Data Classification
- **Public**: Marketing material, public blog posts.
- **Internal**: SOPs, internal documentation, non-sensitive reports (this document).
- **Confidential**: Customer data, financial records, employee salary data.
- **Restricted**: Credentials, encryption keys, security incident reports.

## Access Principles
- Access to Confidential and Restricted data follows the principle of least privilege.
- All access to the production PostgreSQL database must go through approved service
  accounts; direct personal access requires Head of Engineering approval.
- The AI Company Assistant only has **read-only** access to business data tables and
  cannot execute write operations, in order to prevent unintended data modification via
  the chatbot interface.

## Incident Reporting
Any suspected data breach or leak must be reported immediately to the Security team via
the `#security-incidents` channel and the on-call engineer must be paged within 15
minutes of discovery.

## Password & Credential Policy
- Minimum 12 characters, rotated every 90 days for privileged accounts.
- No credentials may be stored in plaintext in source code or configuration files;
  use environment variables or a secrets manager.
