# SOP: Production Incident Response

## Severity Levels
- **SEV-1 (Critical):** Full outage or data breach. Page on-call immediately, all-hands
  response, customer communication within 30 minutes.
- **SEV-2 (High):** Partial outage or major feature degradation. Page on-call, response
  within 15 minutes, no mandatory customer communication unless SEV-1 escalation.
- **SEV-3 (Medium):** Minor bug affecting a subset of users, no immediate paging required;
  handled during business hours.

## Response Steps
1. Whoever detects the incident posts in `#incidents` with severity, affected system, and
   impact summary.
2. On-call engineer acknowledges within the SLA for that severity and becomes Incident
   Commander (IC) until handoff.
3. IC coordinates the fix, keeps a running timeline in the incident channel, and decides
   when to declare "resolved."
4. A postmortem document is required for all SEV-1 and SEV-2 incidents within 3 working
   days of resolution — focused on root cause and prevention, not blame.

## On-Call Rotation
Engineering on-call rotates weekly, managed via the on-call scheduling tool. Swap requests
must be posted in `#oncall-swaps` at least 24 hours in advance.

## Escalation
If the primary on-call does not acknowledge within the SLA, PagerDuty automatically
escalates to the secondary on-call, then to the Head of Engineering.
