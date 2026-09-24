// TIER-1/TIER-2 REPAIR — semantic proof tests for P2.
// Every assertion here fails against the unrepaired baseline.

import { describe, expect, it } from "vitest";
import { parseResearchPackage, verifyResearchPackageIntegrity } from "../src/ingest.js";
import { HandoffValidationError, TraceabilityError } from "../src/errors.js";
import { RESEARCH_PACKAGE_FIXTURE, sealResearchPackage } from "./fixtures/research_package.fixture.js";
import { InMemoryPromptLibrary, generateIndividualAssetPrompts } from "../src/promptArchitecture.js";
import { draftProductionPackage, runP210VoiceSpec } from "../src/pipeline.js";
import { voiceScriptFromLines, verifyVoiceScriptConsistency } from "../src/voiceSpec.js";
import { recommend, recordHumanDecision } from "../src/aiDirector.js";
import { runFullPipeline } from "./pipeline.integration.test.js";
import { validateTraceabilityChain } from "../src/traceability.js";
import { contentHash } from "../src/canonicalIdentity.js";
import type {
  ArtDirection,
  AssetRequirement,
  ContentStructure,
  Decision,
  PromptSpecification,
  Scene,
  Shot,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// T1.2 — real integrity verification at the P1 -> P2 boundary
// ---------------------------------------------------------------------------

describe("T1.2 P1 -> P2 integrity verification", () => {
  it("accepts a genuinely sealed Research Package", () => {
    expect(() => parseResearchPackage(RESEARCH_PACKAGE_FIXTURE)).not.toThrow();
  });

  it("rejects a package whose content was modified in transit", () => {
    const tampered = {
      ...RESEARCH_PACKAGE_FIXTURE,
      handoff_notes: `${RESEARCH_PACKAGE_FIXTURE.handoff_notes} (edited in transit)`,
    };
    expect(() => parseResearchPackage(tampered)).toThrow(HandoffValidationError);
  });

  it("rejects a mutated claim even though the declared hash still 'looks like' a sha256", () => {
    const tampered = {
      ...RESEARCH_PACKAGE_FIXTURE,
      claims: RESEARCH_PACKAGE_FIXTURE.claims.map((c, i) =>
        i === 0 ? { ...c, statement: "a completely different assertion" } : c,
      ),
    };
    expect(RESEARCH_PACKAGE_FIXTURE.integrity_hashes.package_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Before the repair this passed: the hash was only shape-checked.
    expect(() => parseResearchPackage(tampered)).toThrow(HandoffValidationError);
  });

  it("rejects a poisoned per-file hash", () => {
    const paths = Object.keys(RESEARCH_PACKAGE_FIXTURE.integrity_hashes.per_file);
    const tampered = {
      ...RESEARCH_PACKAGE_FIXTURE,
      integrity_hashes: {
        ...RESEARCH_PACKAGE_FIXTURE.integrity_hashes,
        per_file: { ...RESEARCH_PACKAGE_FIXTURE.integrity_hashes.per_file, [paths[0]!]: "0".repeat(64) },
      },
    };
    expect(() => parseResearchPackage(tampered)).toThrow(HandoffValidationError);
  });

  it("rejects a poisoned manifest entry", () => {
    const tampered = {
      ...RESEARCH_PACKAGE_FIXTURE,
      manifest: RESEARCH_PACKAGE_FIXTURE.manifest.map((m, i) =>
        i === 0 ? { ...m, sha256: "f".repeat(64) } : m,
      ),
    };
    expect(() => parseResearchPackage(tampered)).toThrow(HandoffValidationError);
  });

  it("re-sealing after a legitimate edit verifies again", () => {
    const edited = sealResearchPackage({
      ...RESEARCH_PACKAGE_FIXTURE,
      handoff_notes: "legitimately revised and re-sealed",
    } as unknown as Record<string, unknown>);
    expect(() => verifyResearchPackageIntegrity(edited as Record<string, unknown>)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T2.3 — versioned prompt library
// ---------------------------------------------------------------------------

function spec(id: string, version: number, subject: string): PromptSpecification {
  return {
    prompt_spec_id: id,
    version,
    subject,
    composition: "wide",
    style: "documentary",
    negative_constraints: [],
    prompt_family: "flow.shot.wide",
    axis_tags: ["wide"],
    traceable_to: { shot_id: "shot_1", asset_requirement_id: "astreq_1", decision_id: "dec_1" },
  };
}

describe("T2.3 prompt library versioning", () => {
  it("storing a new version does not destroy the previous one", () => {
    const lib = new InMemoryPromptLibrary();
    lib.store(spec("pspec_1", 1, "v1 subject"));
    lib.store(spec("pspec_1", 2, "v2 subject"));
    // Before the repair the map was keyed on prompt_spec_id alone, so v1 was
    // silently overwritten and history was unrecoverable.
    expect(lib.versions("pspec_1")).toHaveLength(2);
    expect(lib.get("pspec_1", 1)!.subject).toBe("v1 subject");
    expect(lib.get("pspec_1", 2)!.subject).toBe("v2 subject");
  });

  it("get() with no version returns the latest", () => {
    const lib = new InMemoryPromptLibrary();
    lib.store(spec("pspec_1", 1, "old"));
    lib.store(spec("pspec_1", 3, "newest"));
    expect(lib.get("pspec_1")!.version).toBe(3);
  });

  it("re-storing an identical version is idempotent", () => {
    const lib = new InMemoryPromptLibrary();
    lib.store(spec("pspec_1", 1, "same"));
    expect(() => lib.store(spec("pspec_1", 1, "same"))).not.toThrow();
    expect(lib.all()).toHaveLength(1);
  });

  it("reusing a version number for different content is refused", () => {
    const lib = new InMemoryPromptLibrary();
    lib.store(spec("pspec_1", 1, "original"));
    expect(() => lib.store(spec("pspec_1", 1, "silently different"))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// T1.7 — Shot -> AssetRequirement -> Prompt lineage
// ---------------------------------------------------------------------------

describe("T1.7 prompt lineage", () => {
  const artDirection: ArtDirection = {
    art_direction_id: "ad_1",
    visual_language: "warm documentary",
    color_palette: [],
    lighting: "golden hour",
    composition_rules: [],
    checklist: ["consistent stonework"],
    decision_ids: ["dec_1"],
  } as unknown as ArtDirection;

  const requirement = (id: string, shot: string): AssetRequirement => ({
    asset_requirement_id: id,
    shot_id: shot,
    expected_media_type: "VISUAL_IMAGE",
    expected_media_properties: {},
    generation_method: "google_flow",
    reference_lineage: [],
    required: true,
  });

  it("a generated prompt carries its asset_requirement_id", () => {
    const prompts = generateIndividualAssetPrompts([requirement("astreq_1", "shot_1")], artDirection, "dec_1");
    expect(prompts[0]!.traceable_to.asset_requirement_id).toBe("astreq_1");
    expect(prompts[0]!.traceable_to.shot_id).toBe("shot_1");
  });

  it("an empty decision_id is refused instead of silently emitted", () => {
    // Before the repair this function hardcoded decision_id: "" — a value
    // that can never resolve against the decision log.
    expect(() =>
      generateIndividualAssetPrompts([requirement("astreq_1", "shot_1")], artDirection, ""),
    ).toThrow();
  });

  it("two requirements on the SAME shot get distinct prompt ids", () => {
    const prompts = generateIndividualAssetPrompts(
      [requirement("astreq_1", "shot_1"), requirement("astreq_2", "shot_1")],
      artDirection,
      "dec_1",
    );
    expect(prompts[0]!.prompt_spec_id).not.toBe(prompts[1]!.prompt_spec_id);
  });
});

// ---------------------------------------------------------------------------
// T2.1 / T2.2 — scene<->shot equality and shot coverage
// ---------------------------------------------------------------------------

function chain() {
  const shot: Shot = {
    shot_id: "shot_1",
    scene_id: "scene_1",
    purpose: "wide",
    duration_intention: "3s",
    camera: { angle: "low", movement: "static", lens: "wide", framing: "wide" },
    action: "hold",
    continuity_anchors: [],
    reference_requirements: [],
    asset_type: "VISUAL_IMAGE",
    generation_method: "google_flow",
  };
  const scene: Scene = {
    scene_id: "scene_1",
    purpose: "open",
    shots: ["shot_1"],
    continuity_requirements: [],
    narrative_function: "establish",
  };
  const decision: Decision = {
    decision_id: "dec_1",
    question: "q",
    options_considered: [],
    recommendation: "r",
    rationale: "why",
    status: "approved",
    timestamp: "2026-01-01T00:00:00.000Z",
    precedent_refs: [],
  };
  const artDirection = {
    art_direction_id: "ad_1",
    visual_language: "warm",
    color_palette: [],
    lighting: "golden",
    composition_rules: [],
    checklist: [],
    decision_ids: ["dec_1"],
  } as unknown as ArtDirection;
  const assetRequirement: AssetRequirement = {
    asset_requirement_id: "astreq_1",
    shot_id: "shot_1",
    expected_media_type: "VISUAL_IMAGE",
    expected_media_properties: {},
    generation_method: "google_flow",
    reference_lineage: [],
    required: true,
  };
  const contentStructure = { key_claims_used: ["claim_1"] } as unknown as ContentStructure;
  return {
    claimIds: new Set(["claim_1"]),
    contentStructure,
    decisions: [decision],
    artDirection,
    scenes: [scene],
    shots: [shot],
    assetRequirements: [assetRequirement],
    prompts: [spec("pspec_1", 1, "s")],
  };
}

describe("T2.1 scene <-> shot exact equality", () => {
  it("accepts a consistent chain", () => {
    expect(() => validateTraceabilityChain(chain())).not.toThrow();
  });

  it("rejects a shot claiming a scene that does not list it", () => {
    const c = chain();
    c.scenes = [{ ...c.scenes[0]!, shots: [] }];
    // Both directions individually "resolved" before the repair: the shot's
    // scene_id existed, and the scene listed no unknown shots.
    expect(() => validateTraceabilityChain(c)).toThrow(TraceabilityError);
  });

  it("rejects a scene listing a shot whose scene_id points elsewhere", () => {
    const c = chain();
    c.scenes = [
      { ...c.scenes[0]!, shots: ["shot_1"] },
      { scene_id: "scene_2", purpose: "p", shots: ["shot_1"], continuity_requirements: [], narrative_function: "n" },
    ];
    expect(() => validateTraceabilityChain(c)).toThrow(TraceabilityError);
  });
});

describe("T2.2 shot -> asset requirement coverage", () => {
  it("rejects a shot with no asset requirement", () => {
    const c = chain();
    c.shots = [
      ...c.shots,
      { ...c.shots[0]!, shot_id: "shot_unplanned" },
    ];
    c.scenes = [{ ...c.scenes[0]!, shots: ["shot_1", "shot_unplanned"] }];
    expect(() => validateTraceabilityChain(c)).toThrow(TraceabilityError);
  });
});

describe("T1.7 prompt -> requirement resolution", () => {
  it("rejects a prompt pointing at an unknown asset requirement", () => {
    const c = chain();
    c.prompts = [
      { ...c.prompts[0]!, traceable_to: { shot_id: "shot_1", asset_requirement_id: "nope", decision_id: "dec_1" } },
    ];
    expect(() => validateTraceabilityChain(c)).toThrow(TraceabilityError);
  });

  it("rejects a prompt whose requirement belongs to a different shot", () => {
    const c = chain();
    c.shots = [...c.shots, { ...c.shots[0]!, shot_id: "shot_2" }];
    c.scenes = [{ ...c.scenes[0]!, shots: ["shot_1", "shot_2"] }];
    c.assetRequirements = [...c.assetRequirements, { ...c.assetRequirements[0]!, asset_requirement_id: "astreq_2", shot_id: "shot_2" }];
    c.prompts = [
      { ...c.prompts[0]!, traceable_to: { shot_id: "shot_2", asset_requirement_id: "astreq_1", decision_id: "dec_1" } },
    ];
    expect(() => validateTraceabilityChain(c)).toThrow(TraceabilityError);
  });
});

describe("T1.1 canonical identity", () => {
  it("content hash is order-independent but content-sensitive", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1, b: 2 })).not.toBe(contentHash({ a: 1, b: 3 }));
  });
});


// ---------------------------------------------------------------------------
// R01.3 — VoiceLine <-> voice_script drift prevention
// ---------------------------------------------------------------------------

describe("R01.3 VoiceLine <-> voice_script consistency", () => {
  it("voice_script is derived from voice_lines, not independently constructed", () => {
    const { voice_script, voice_lines } = runP210VoiceSpec([
      { text: "First line.", claim_id: "claim_a" },
      { text: "Second line, no claim binding." },
    ]);
    expect(voiceScriptFromLines(voice_lines)).toBe(voice_script);
  });

  it("a legitimately claim-less line does not require claim_id", () => {
    const { voice_lines } = runP210VoiceSpec([{ text: "Transition sentence with no specific claim." }]);
    expect(voice_lines[0]!.claim_id).toBeUndefined();
  });

  it("verifyVoiceScriptConsistency detects drift introduced by an alternate construction path", () => {
    const { voice_lines } = runP210VoiceSpec([{ text: "Original narration line.", claim_id: "claim_a" }]);
    // Simulate an edit path that touched voice_script but not voice_lines.
    const driftedScript = "A completely different, unrelated script.";
    const result = verifyVoiceScriptConsistency(driftedScript, voice_lines);
    expect(result.valid).toBe(false);
  });

  it("draftProductionPackage rejects a package whose voice_script has drifted from voice_lines", async () => {
    const { draft } = await runFullPipeline();
    const { voice_lines } = runP210VoiceSpec([
      { text: "Real narration line.", claim_id: "claim_facts_aquaappia" },
    ]);
    expect(() =>
      draftProductionPackage({
        pkg: { package_id: draft.research_package_ref } as never, // not re-parsed; only used for claim FK checks below
        contentStructure: {} as never,
        decisionLog: [],
        artDirection: {} as never,
        scenes: draft.scenes,
        shots: draft.shots,
        assetRequirements: draft.asset_requirements,
        prompts: draft.prompts,
        voiceScript: "A DIFFERENT script that does not match voice_lines at all.",
        pronunciationFlags: [],
        voiceLines: voice_lines,
        gates: draft.user_approval_state,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// R01.4 — "modified" decision semantics
// ---------------------------------------------------------------------------

describe("R01.4 modified decision semantics", () => {
  function baseDecision(): Decision {
    return recommend({
      question: "Which visual language?",
      optionsConsidered: [
        { choice: "warm documentary", pros: ["approachable"], cons: [] },
        { choice: "cold clinical", pros: ["precise"], cons: ["distant"] },
      ],
      recommendation: "warm documentary",
      rationale: "fits the subject",
      targetId: "shot_1",
    });
  }

  it("outcome 'modified' with no modifiedChoice is refused, not silently a no-op", () => {
    const decision = baseDecision();
    expect(() => recordHumanDecision(decision, "user:reviewer", "modified")).toThrow();
  });

  it("outcome 'modified' with a modifiedChoice identical to the current recommendation is refused", () => {
    const decision = baseDecision();
    expect(() => recordHumanDecision(decision, "user:reviewer", "modified", "warm documentary")).toThrow();
  });

  it("outcome 'modified' with a genuinely different choice is recorded correctly", () => {
    const decision = baseDecision();
    const result = recordHumanDecision(decision, "user:reviewer", "modified", "cold clinical");
    expect(result.status).toBe("modified");
    expect(result.recommendation).toBe("cold clinical");
  });

  it("accepting the recommendation as-is uses 'approved', not 'modified'", () => {
    const decision = baseDecision();
    const result = recordHumanDecision(decision, "user:reviewer", "approved");
    expect(result.status).toBe("approved");
    expect(result.recommendation).toBe(decision.recommendation);
  });
});
