// P1 stage runner: file-driven research through the REAL P1 phases (Gate A1 in two parts).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { p1Approve, p1Draft, p1Scope, validateP1Input } from "../src/stages/p1.js";
import { buildStrategyInputBundle } from "../src/index.js";
import { AT, OWNER } from "./helpers.js";

const EXAMPLE = JSON.parse(readFileSync(resolve(__dirname, "../../../docs/examples/p1_input.example.json"), "utf8"));
const now = () => AT;

/** The example with every <placeholder> filled in, as a user would. */
function filled(): any {
  const x = JSON.parse(JSON.stringify(EXAMPLE));
  x.findings.forEach((f: any, i: number) => {
    f.source.origin = `https://example.org/source-${i}`;
    f.excerpt = `p. ${10 + i}`;
  });
  x.verifications[0].rationale = "Cross-checked in two independent editions (test).";
  x.verifications[0].status = "VERIFIED";
  x.verifications[0].cross_checked_with = ["https://example.org/independent-edition"];
  return x;
}

describe("P1 stage runner", () => {
  it("scope can be proposed before any research exists; placeholders in scope fields are refused", () => {
    const early = { ...filled(), findings: [], verifications: [] };
    expect(() => p1Scope({ input: early, now })).not.toThrow();
    expect(() => p1Scope({ input: { ...early, question: "<ana soru>" }, now })).toThrow(/question/);
  });

  it("rejects the shipped example until its placeholders are filled, listing every problem", () => {
    expect(() => validateP1Input(EXAMPLE)).toThrow(/P1_INPUT_INVALID[\s\S]*source\.origin[\s\S]*excerpt/);
    expect(() => validateP1Input(filled())).not.toThrow();
  });

  it("VERIFIED needs an independent second source; the finding's own source does not count", () => {
    const x = filled();
    x.verifications[0].cross_checked_with = [x.findings[0].source.origin];
    expect(() => validateP1Input(x)).toThrow(/bağımsız kaynak/);
    delete x.verifications[0].cross_checked_with;
    expect(() => validateP1Input(x)).toThrow(/bağımsız kaynak/);
    x.verifications[0].status = "INFERRED";
    expect(() => validateP1Input(x)).not.toThrow();
  });

  it("rejects findings that answer no listed question, and unknown verification statements", () => {
    const x = filled();
    x.findings[0].query = "başka bir soru";
    x.verifications.push({ statement: "hiç bulunmayan ifade", status: "INFERRED", rationale: "x" });
    expect(() => validateP1Input(x)).toThrow(/findings\[0\][\s\S]*verifications\[1\]/);
  });

  it("scope → draft → approve produces a Gate-A1 research package the B bridge accepts", async () => {
    const input = filled();
    const { proposal, review } = p1Scope({ input, now });
    expect(review).toContain("Taydula Hatun");
    const { draft, review: r2 } = await p1Draft({ input, scopeProposal: proposal, scopeApprovedBy: OWNER, now });
    expect(r2).toContain("✔ VERIFIED");
    expect(r2).toContain("≈ INFERRED");
    const research = p1Approve({ draft, actor: OWNER, review: r2 });
    expect(research.claims).toHaveLength(3);
    expect(research.gates.map((g: any) => g.state_after)).toContain("PACKAGE_APPROVED");
    // the real bridge into B accepts it (Gate A1 + integrity hashes)
    expect(() => buildStrategyInputBundle(research, { now })).not.toThrow();
  });

  it("human gates need a named person; an edited input, draft or review is refused", async () => {
    const input = filled();
    const { proposal } = p1Scope({ input, now });
    await expect(p1Draft({ input, scopeProposal: proposal, scopeApprovedBy: "<adınız>", now })).rejects.toThrow(/AUTHORITY_REQUIRED/);
    // research may be added after the scope approval; scope fields may not change
    const moreResearch = JSON.parse(JSON.stringify(input));
    moreResearch.findings.push({ ...moreResearch.findings[0], statement: "Ek bulgu (test)." });
    await expect(p1Draft({ input: moreResearch, scopeProposal: proposal, scopeApprovedBy: OWNER, now })).resolves.toBeTruthy();
    const changed = { ...input, question: "başka soru" };
    await expect(p1Draft({ input: changed, scopeProposal: proposal, scopeApprovedBy: OWNER, now })).rejects.toThrow(/P1_INPUT_CHANGED/);

    const { draft, review } = await p1Draft({ input, scopeProposal: proposal, scopeApprovedBy: OWNER, now });
    expect(() => p1Approve({ draft, actor: "PREVIEW" })).toThrow(/AUTHORITY_REQUIRED/);
    const edited = JSON.parse(JSON.stringify(draft));
    edited.handoff.claims[0].statement = "Taydula imparatoriçeydi.";
    expect(() => p1Approve({ draft: edited, actor: OWNER })).toThrow(/P1_DRAFT_CHANGED/);
    expect(() => p1Approve({ draft, actor: OWNER, review: review + "x" })).toThrow(/P1_REVIEW_MISMATCH/);
  });
});
