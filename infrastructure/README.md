# Infrastructure

This folder holds everything needed to stand up the platform's supporting
infrastructure locally via `docker-compose` (see root `docker-compose.yaml`):

- `postgres/init.sql` schema for business data tables (`employees`, `sales`,
  `support_tickets`), the `kb_documents` pgvector table, dummy seed data, and the
  least-privilege `readonly_bot` Postgres role used by the MCP `query_database` tool.
- `knowledge_base/` dummy markdown SOP/knowledge documents used to seed the
  Knowledge Base. The `worker` service ingests every `.md` file here on startup.

In a production deployment, this folder is where Terraform/Kubernetes manifests would
live for provisioning managed Postgres, Redis, and container hosting kept minimal
here since the test scope targets a local Docker Compose deployment.
