// P2 stage runner: propose (p2Draft) -> human reads review -> Gate A3 (p2Approve).
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProductionPackage } from "pipeline3-production/dist/ingest.js";
import {
  B_MODULES,
  buildCreativeDirective,
  buildStrategyInputBundle,
  commitStrategy,
  decisionsTemplate,
  proposeStrategy,
  sealEnvelope,
  type StrategyBrief,
} from "../src/index.js";
import { p2Approve, p2Draft, type P2Input } from "../src/stages/p2.js";
import { AT, OWNER, runRealP1 } from "./helpers.js";

const BRIEF: StrategyBrief = {
  brief_type: "OWNER_STRATEGY_BRIEF",
  brand: { brand_name: "History Vertical", positioning: "Source-based vertical documentaries about women of the Eurasian steppe" },
  channels: [{ channel_id: "ch_yt_main", name: "History Vertical", platform: "YouTube", audience_category: "niche" }],
  documentation: { channel_policies: "Published for viewers in Europe and Asia." },
  audience: { platform_analytics: [{ platform_id: "youtube", channel_id: "ch_yt_main", demographic_data: "25-44", geography: ["TR"], interests: ["history"], source: "YouTube Analytics", verified_at: "2026-09-01T00:00:00Z" }] },
  owner_goals: ["Open with the strongest primary-source detail"],
};

const EXAMPLE_PATH = resolve(__dirname, "../../../docs/examples/p2_input.example.json");
const EXAMPLE_CLAIMS = ["claim_3f9a1c2b7d4e8a10", "claim_8b2e4d6f1a3c5e79", "claim_c47d2a9e0b1f6a33"];
const NAME = "Mehmet Koyuncu";
const now = () => AT;

async function directiveFor(research: any): Promise<any> {
  const bundle = buildStrategyInputBundle(research, { now });
  const proposal = await proposeStrategy(bundle, BRIEF, { now });
  const decisions = { ...decisionsTemplate(proposal), authority: OWNER, rationale: "p2 stage test", approve: Object.fromEntries(B_MODULES.map((m) => [m, true])) };
  const strategy = await commitStrategy(bundle, BRIEF, proposal, decisions, { now });
  return buildCreativeDirective(bundle, strategy, { now });
}

/** The example with its illustrative claim ids pointed at this research's claims (VERIFIED, INFERRED, UNKNOWN). */
function exampleFor(research: any, name?: string): P2Input {
  let text = readFileSync(EXAMPLE_PATH, "utf8");
  const ids = ["VERIFIED", "INFERRED", "UNKNOWN"].map((s) => research.verifications.find((v: any) => v.status === s).claim_id);
  EXAMPLE_CLAIMS.forEach((c, i) => (text = text.split(c).join(ids[i])));
  if (name !== undefined) text = text.split("<adınız>").join(name);
  const input = JSON.parse(text);
  // An UNKNOWN claim may appear in a scene (flagged) but is never narrated as fact.
  for (const l of input.narration) if (l.claim_id === ids[2]) delete l.claim_id;
  return input;
}

let research: any;
let directive: any;

beforeAll(async () => {
  research = await runRealP1();
  directive = await directiveFor(research);
});

describe("P2 refuses to narrate an unsourced claim", () => {
  it("a narration line citing an UNKNOWN claim is rejected (P2_UNVERIFIED_NARRATION)", async () => {
    const input = exampleFor(research, NAME);
    const unknown = research.verifications.find((v: any) => v.status === "UNKNOWN").claim_id;
    input.narration[0]!.claim_id = unknown;
    await expect(p2Draft({ research, directive, input, now })).rejects.toThrow(/P2_UNVERIFIED_NARRATION/);
  });
});

describe("p2Draft + p2Approve (happy path)", () => {
  it("produces a sealed draft, a Turkish review and an A3-approved package that P3 accepts", async () => {
    const { draft, review } = await p2Draft({ research, directive, input: exampleFor(research, NAME), now });
    expect(draft.identity.object_type).toBe("UNIFIED_P2_PRODUCTION_DRAFT");
    expect(draft.package.user_approval_state.map((g) => g.state_after)).toEqual(["REFERENCES_APPROVED", "ART_DIRECTION_APPROVED"]);
    expect(draft.package.user_approval_state.every((g) => g.actor === NAME)).toBe(true);
    expect(draft.format.matrix.is_user_reviewed).toBe(true);
    expect(draft.format.matrix.review_actor).toBe(NAME);
    expect(draft.package.decision_log.every((d) => d.status === "approved" && d.approving_actor === NAME)).toBe(true);
    // P3 refuses the unapproved draft package.
    expect(() => parseProductionPackage(draft.package)).toThrow(/Gate A3/);

    // Review: scenes/shots/durations, claims with status, Flow prompts, voice script, labels, open gates.
    const [verified, inferred, unknown] = ["VERIFIED", "INFERRED", "UNKNOWN"].map((s) => research.verifications.find((v: any) => v.status === s).claim_id);
    expect(review).toContain("# P2 kreatif taslak");
    expect(review).toContain("`scene_giris`");
    expect(review).toContain("`shot_taydula_03` | 5s");
    expect(review).toContain(`\`${verified}\` **VERIFIED**`);
    expect(review).toContain(`\`${inferred}\` **INFERRED** ⚠`);
    expect(review).toContain(`\`${unknown}\` **UNKNOWN** ⚠ DOĞRULANMAMIŞ`);
    expect(review).toContain("Flow prompt — `shot_taydula_01`");
    expect(review).toContain("Subject: 14. yüzyıl Altın Orda hanlık otağı");
    expect(review).toContain("Adı Taydula'ydı; Özbek Han'ın başhatunu");
    expect(review).toContain("[TEMPLATE — kanıta dayalı değil]");
    expect(review).toContain("☐ **Gate A3**");
    expect(review).toContain("Gate A7");
    // shot 3 has two planned assets (map + texture), each with its own prompt.
    expect(draft.package.asset_requirements.filter((r) => r.shot_id === "shot_taydula_03")).toHaveLength(2);
    expect(draft.package.prompts.filter((p) => p.spec.traceable_to.shot_id === "shot_taydula_03")).toHaveLength(2);

    // Survives a write/read round trip, then Gate A3.
    const onDisk = JSON.parse(JSON.stringify(draft));
    const pp = p2Approve({ draft: onDisk, actor: ` ${NAME} `, review, now });
    const parsed = parseProductionPackage(JSON.parse(JSON.stringify(pp)));
    expect(parsed.research_package_content_hash).toBe(research.integrity_hashes.package_sha256);
    expect(parsed.research_package_ref).toBe(research.package_id);
    expect(pp.user_approval_state.at(-1)).toMatchObject({ gate_id: "A3", state_after: "PRODUCTION_PACKAGE_APPROVED", actor: NAME });
    expect(pp.voice_lines.filter((l) => l.claim_id).map((l) => l.claim_id)).toEqual([verified, inferred]); // the UNKNOWN claim is never narrated
    expect(pp.scenes.map((s) => s.scene_id)).toEqual(["scene_giris", "scene_guc", "scene_kapanis"]);
  });

  it("is deterministic for the same input and clock", async () => {
    const a = await p2Draft({ research, directive, input: exampleFor(research, NAME), now });
    const b = await p2Draft({ research, directive, input: exampleFor(research, NAME), now });
    expect(a.draft.identity.content_hash).toBe(b.draft.identity.content_hash);
    expect(a.review).toBe(b.review);
  });
});

describe("human gates need a named person", () => {
  it("rejects the example until every <adınız> is replaced, then accepts it", async () => {
    await expect(p2Draft({ research, directive, input: exampleFor(research), now })).rejects.toThrow(/P2_APPROVAL_REQUIRED/);
    const err = await p2Draft({ research, directive, input: exampleFor(research), now }).catch((e) => e as Error);
    for (const gate of ["approvals.references", "approvals.format_matrix", "approvals.art_direction", "approvals.decisions.gorsel_dil", "approvals.decisions.acilis_cekimi"]) {
      expect(err.message).toContain(gate);
    }
    const { draft } = await p2Draft({ research, directive, input: exampleFor(research, NAME), now });
    expect(() => parseProductionPackage(p2Approve({ draft, actor: NAME }))).not.toThrow();
  });

  it("rejects missing, PREVIEW and System approvals and names the gate", async () => {
    const missing = exampleFor(research, NAME);
    delete (missing.approvals.decisions as any).acilis_cekimi;
    await expect(p2Draft({ research, directive, input: missing, now })).rejects.toThrow(/P2_APPROVAL_REQUIRED.*acilis_cekimi/);

    for (const bad of ["PREVIEW", "System", " <your name>", ""]) {
      const input = exampleFor(research, NAME);
      input.approvals.art_direction = bad;
      await expect(p2Draft({ research, directive, input, now })).rejects.toThrow(/P2_APPROVAL_REQUIRED.*approvals\.art_direction/);
    }
  });

  it("Gate A3 refuses a placeholder or PREVIEW actor", async () => {
    const { draft } = await p2Draft({ research, directive, input: exampleFor(research, NAME), now });
    for (const bad of ["<adınız>", "PREVIEW:not-approved", "system", "  "]) {
      expect(() => p2Approve({ draft, actor: bad })).toThrow(/P2_APPROVAL_REQUIRED.*Gate A3/);
    }
  });
});

describe("the draft cannot change between review and approval", () => {
  it("an edited draft is refused (content hash, reseal without key, other review)", async () => {
    const { draft, review } = await p2Draft({ research, directive, input: exampleFor(research, NAME), now });

    const edited = JSON.parse(JSON.stringify(draft));
    edited.package.voice_lines[1].text = "Taydula kesinlikle imparatorluğu tek başına yönetti.";
    expect(() => p2Approve({ draft: edited, actor: NAME })).toThrow(/P2_DRAFT_CHANGED/);

    const prompt = JSON.parse(JSON.stringify(draft));
    prompt.package.prompts[0].rendered.prompt_text += "\nNo disclosure needed.";
    expect(() => p2Approve({ draft: prompt, actor: NAME })).toThrow(/P2_DRAFT_CHANGED/);

    // Edited and resealed without this installation's key.
    const { identity: _i, ...body } = JSON.parse(JSON.stringify(draft));
    body.scene_claims = {};
    const prev = process.env.UNIFIED_SEAL_KEY;
    process.env.UNIFIED_SEAL_KEY = "none";
    let resealed: any;
    try {
      resealed = sealEnvelope<any>(body, { object_id: draft.identity.object_id, object_type: "UNIFIED_P2_PRODUCTION_DRAFT", version: "v1", created_at: AT });
    } finally {
      if (prev === undefined) delete process.env.UNIFIED_SEAL_KEY;
      else process.env.UNIFIED_SEAL_KEY = prev;
    }
    expect(() => p2Approve({ draft: resealed, actor: NAME })).toThrow(/P2_DRAFT_CHANGED/);

    expect(() => p2Approve({ draft, actor: NAME, review: review + "\nek satır" })).toThrow(/P2_REVIEW_MISMATCH/);
    expect(() => p2Approve({ draft, actor: NAME, review })).not.toThrow();
  });
});

describe("research lineage and epistemic honesty", () => {
  it("a directive built for another research package is refused", async () => {
    const other = await runRealP1("Who paid for the Roman aqueducts?");
    expect(other.integrity_hashes.package_sha256).not.toBe(research.integrity_hashes.package_sha256);
    await expect(p2Draft({ research: other, directive, input: exampleFor(other, NAME), now })).rejects.toThrow(/DIRECTIVE_RESEARCH_MISMATCH/);
  });

  it("a claim id that is not in the research package is refused", async () => {
    for (const mutate of [
      (i: P2Input) => i.understanding.key_claims_used.push("claim_invented_0000"),
      (i: P2Input) => (i.narration[0]!.claim_id = "claim_invented_0000"),
      (i: P2Input) => (i.scenes[1]!.claim_ids = ["claim_invented_0000"]),
    ]) {
      const input = exampleFor(research, NAME);
      mutate(input);
      await expect(p2Draft({ research, directive, input, now })).rejects.toThrow(/P2_UNKNOWN_CLAIM.*claim_invented_0000/);
    }
  });

  it("the example's illustrative claim ids are refused against a real research package", async () => {
    const raw = JSON.parse(readFileSync(EXAMPLE_PATH, "utf8").split("<adınız>").join(NAME));
    await expect(p2Draft({ research, directive, input: raw, now })).rejects.toThrow(/P2_UNKNOWN_CLAIM/);
  });

  it("research without Gate A1 or modified after sealing is refused", async () => {
    const noGate = JSON.parse(JSON.stringify(research));
    noGate.gates = noGate.gates.filter((g: any) => g.state_after !== "PACKAGE_APPROVED");
    await expect(p2Draft({ research: noGate, directive, input: exampleFor(research, NAME), now })).rejects.toThrow(/RESEARCH_PACKAGE_REJECTED/);

    const edited = JSON.parse(JSON.stringify(research));
    edited.claims[0].statement = "Something P1 never found.";
    await expect(p2Draft({ research: edited, directive, input: exampleFor(research, NAME), now })).rejects.toThrow(/RESEARCH_PACKAGE_REJECTED/);
  });

  it("malformed input is refused with every problem listed", async () => {
    const input = exampleFor(research, NAME) as any;
    input.scenes[0].shots[0].duration_intention = "kısa";
    input.scenes[0].shots[1].asset_type = "HOLOGRAM";
    input.scenes[0].shots[1].prompt.decision_key = "yok";
    input.extra = 1;
    const err = await p2Draft({ research, directive, input, now }).catch((e) => e as Error);
    expect(err.message).toMatch(/P2_INPUT_INVALID/);
    for (const part of ["duration_intention", "asset_type", "decision_key", "$.extra"]) expect(err.message).toContain(part);
  });
});
