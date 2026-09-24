# B08 Agent Reach integration — contract v1

Classification: **FIXED / PARTIALLY VERIFIED**. Adapter/consumer behavior is verified with controlled fixtures. One real public web retrieval is separately recorded. Universal platform access and external content truth are **NOT VERIFIED**.

## Architectural boundary

B00 still owns hashes, identities, evidence semantics, provenance bindings and governance. B08 owns `src/b08/external/`. There is no B13, no vendored Agent Reach source and no credential/session/profile storage in this package. B02/B03/B07 consume validated B08 contexts; B09 consumes B08 state; B10 consumes B09 proposals. No downstream module invokes a provider.

External snapshot references are artifact-level B08 references, not new edges in the strategic module execution DAG. For B02/B03/B07 use a completed external snapshot in a later evaluation run. This does not require running B08's KPI-framework pipeline before creating the external access adapter, and does not create a B07↔B08 orchestration recursion.

## Upstream examined

- Repository: https://github.com/Panniantong/Agent-Reach
- Examined and externally installed commit: `da5044d26fc6adddb6554d5679c94ac22e76e428`
- Installed package: `agent-reach 1.5.0`
- CLI source at the pin: https://github.com/Panniantong/Agent-Reach/blob/da5044d26fc6adddb6554d5679c94ac22e76e428/agent_reach/cli.py
- Backend design: https://github.com/Panniantong/Agent-Reach/blob/da5044d26fc6adddb6554d5679c94ac22e76e428/docs/README_en.md

Agent Reach manages installation/configuration/health and documents backend tools. It does not expose the fictitious generic `agent-reach search/read --json` API. B's `ProviderResponse` is explicitly B-owned, not an upstream protocol. `LocalAgentReachTransport` checks the real `--version` command, uses `doctor` for telemetry, and reads via the documented Jina Reader backend. Other external backends can implement `AgentReachTransport`; unsupported native operations fail explicitly.

## Implemented capability and limits

| Native capability | Implementation | Status |
|---|---|---|
| public HTTPS web read | Agent Reach installation/version + `https://r.jina.ai/<url>` | one live example.com retrieval verified |
| read capability health | B-side registry starts UNKNOWN, updates on attempted retrieval | fixture-tested; live retrieval separately recorded |
| doctor | bounded `agent-reach doctor`, no stdout retained as evidence | NOT VERIFIED — did not finish within local timeout |
| search / RSS / YouTube / Reddit / X / other native backends | not implemented in the native transport | DEFERRED; explicit UNSUPPORTED_CAPABILITY |
| authenticated access | no cookies/credentials in B's request | NOT VERIFIED; external runtime owner responsibility |
| geographic/date filtering | native web transport rejects rather than pretending to filter | UNSUPPORTED_CAPABILITY |

The capability registry records auth/cookie/browser/MCP/proxy requirements and last check time. Installing Agent Reach never marks every platform AVAILABLE. A doctor failure does not prevent a separately available web backend from being tested.

## Runtime setup

Install Agent Reach outside this source tree and configure it separately. The verification environment used an isolated Python venv with:

```bash
python -m venv /path/outside-b/agent-reach-venv
/path/outside-b/agent-reach-venv/bin/python -m pip install \
  https://github.com/Panniantong/Agent-Reach/archive/da5044d26fc6adddb6554d5679c94ac22e76e428.zip
```

No `agent-reach install --system`, cookie extraction, account login, or credential configuration was performed. `verification/current/agent-reach-resolved.txt` records the actually resolved external Python environment. This is an environment record, not a fully hashed cross-platform Python lockfile. B's npm lockfile is independent.

## Public API usage

```ts
import { B02, B03, B07, B08, B09, B10 } from "b-branch-strategic-control-plane";

const access = new B08.AgentReachAdapter(
  new B08.LocalAgentReachTransport("/external/venv/bin/agent-reach")
);
const result = await access.retrieve({
  request_id: "research-run-001",
  project_id: "your-project-id",
  purpose: "Collect a source report relevant to the selected channel",
  query: "https://example.com/",
  source_types: ["web"],
  platform: "web",
  max_results: 1,
  observation_kind: "AudienceObservation",
  channel_id: "an-existing-b01-channel-id",
});
const external_intelligence = { project_id: "your-project-id", results: [result] };
// b01/b04/b06/b07 below are your existing B-Branch states.
const audience = B03.runB03(b01, { b01_canonical_state: b01, external_intelligence });
const b08 = await B08.runB08(b07, b06, b01, { external_intelligence });
const b09 = await B09.runB09(b08, b06);
const b10 = await B10.runB10(b09);
```

For B02 pass a TrendObservation, CompetitiveObservation or CommunityObservation context through `runB02(b01, {external_intelligence})`. B02 preserves existing heuristic scores and UNKNOWN constraints; appending a source does not establish strategic relevance.

B03 accepts AudienceObservation and CommunityObservation, explicitly scoped to a B01 channel ID. Source text is retained unchanged. Existing segmentation/synthesis remains classified HEURISTIC/INFERRED. Inferred labels are not measured population demographics. No request geography is converted into observed audience geography.

## Traceable chain and epistemic policy

1. Allowlisted, validated `ExternalAccessRequest` (project, channel, question, limits).
2. B-owned transport returns source locators, exact content, backend/version and retrieval time.
3. B00 SHA-256 computes source locator identity and exact content hash.
4. B08 creates `EvidenceRef` with `status: UNKNOWN`, explicit source mode, and `production_eligible: false`.
5. B00 validates evidence semantics.
6. Subject-bound source provenance references evidence IDs; normalized observation provenance links to source provenance.
7. Result gets a canonical identity. Consumer validation reconstructs **all** derived fields and compares them, including after an attacker recomputes a tampered envelope hash.
8. Project and channel scoping is enforced before use. MOCK/SYNTHETIC/UNKNOWN stay auditable in B08 but cannot reach real-world consumer evidence paths.

`retrieved_at`/`observed_at` mean collection time, not publication time or the occurrence time of a claim. A SHA-256 match proves integrity, not truth or independent authenticity. Source content remains data, never executable instructions.

## Independent review: B09 and actual KPI use

Retrieval alone produces no B09 learning observation and no B07 actual metric value. `ExternalObservationReview` must contain:

- exact observation ID and canonical content hash;
- reviewer identity and review time;
- separately supplied REAL/VERIFIED confirmation evidence that passes B00 evidence semantics and is not merely the same retrieval EvidenceRef;
- a B00 approval history bound to `externalReviewBinding(review)`.

Prepare a review using actual independently confirmed evidence from the caller's review workflow. Use B00 `proposeItem` and `approveItem` with `requireArtifactBinding: true`, the binding returned by `externalReviewBinding`, and the actual evidence IDs. Approval applies to that review artifact; it does **not** turn source retrieval evidence into VERIFIED. Changing the review, its evidence, or its observation invalidates approval.

The caller remains responsible for authenticating the reviewer and substantiating supplied confirmation evidence. These in-memory governance records are not digital signatures or an external fact-checking service. The adapter does not generate confirmation evidence.

Reviewed nonmetric reports produce neutral B09 observations/signals, with no invented magnitude, target comparison or causal interpretation. B09 may propose assessing their strategic relevance; B10 produces an owner-reviewed proposal with `required_approval: true`. No strategic change is applied.

## Performance observations

Generic prose or social engagement chatter is never converted to KPIs. A PerformanceObservation requires explicit JSON in the retained source text:

```json
{"measurement":{"metric_id":"existing-kpi-id","channel_id":"existing-channel-id","value":42,"unit":"matching-kpi-unit","period_start":"2026-09-01T00:00:00Z","period_end":"2026-09-02T00:00:00Z"}}
```

This is a **schema example**, not real performance evidence. Values must be finite; period order and requested range, when supported by the transport, must be valid. B07 matches KPI ID, channel ID and unit. It retains measured source reports separately and sets an actual value only when exactly one matching report has an eligible independent review. Ambiguous multiple reports do not select an arbitrary winner. Targets/defaults remain unchanged.

## Error and secret boundaries

Failures: UNAVAILABLE, AUTH_REQUIRED, UNSUPPORTED_CAPABILITY, RATE_LIMITED, FAILED, MALFORMED_RESULT. Failure results have no sources/evidence. Timeout aborts transport work and resolves even for an uncooperative injected transport. Native subprocess calls have no shell, fixed arguments and bounded output. Native fetch uses a fixed public backend, no redirects and bounded response bytes. Credential-bearing source URLs are rejected. Provider error payloads/stdout/stderr are not echoed into artifacts. Configure auth only outside B.

## Verification

```bash
npm ci
npm run typecheck
npm run typecheck:repair
npm run build
npm run test:agent-reach
node scripts/live-agent-reach.mjs /external/venv/bin/agent-reach /absolute/live-report.json
```

Unit/integration tests use controlled fixtures and explicitly label them as such. A fixture with declared REAL semantics tests policy behavior; it is not a claim of live collection. The live provider response explicitly reported a cached snapshot; current origin-page freshness is NOT VERIFIED. Live status, normalized real example result, source hash and evidence status are retained separately under `verification/current/`.
