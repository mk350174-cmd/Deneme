// C3 (small improvements, P2.03 creative strategy spectrum) — proves the
// new fields are optional (old fixtures without them still work) and that
// runP203Strategize actually threads priorApproaches through to the engine,
// reusing the existing memory.ts read path (no new storage mechanism).

import { describe, expect, it } from "vitest";
import { runP203Strategize } from "../src/pipeline.js";
import type { CreativeReasoningEngine } from "../src/creativeReasoningEngine.js";
import type { ContentStructure, CreativeApproach, CreativeStrategy, MemoryRecord } from "../src/types.js";

const contentStructure: ContentStructure = {
  central_idea: "Roman aqueducts as an engineering achievement",
  key_claims_used: [],
  narrative_material: [],
  objective: "inform",
};

function memoryRecord(content: string): MemoryRecord {
  return {
    record_id: `mem_${content}`,
    bucket: "CREATIVE_HISTORY",
    record_type: "OBSERVATION",
    content,
    created_at: new Date().toISOString(),
  };
}

// A tiny test-local engine (not ManualCreativeReasoningEngine, which
// deliberately ignores its params) that actually varies its output based
// on priorApproaches — proves the new param is real plumbing, not a no-op.
function engineThatAvoidsRepetition(): CreativeReasoningEngine {
  return {
    async understand() {
      throw new Error("not used in this test");
    },
    async strategize(_cs, _goals, priorApproaches?: MemoryRecord[]): Promise<CreativeStrategy> {
      const avoid = new Set((priorApproaches ?? []).map((r) => r.content));
      const approach: CreativeApproach = avoid.has("documentary") ? "cinematic" : "documentary";
      return {
        strategy_id: "strat_1",
        communication_direction: "informative",
        narrative_direction: "chronological",
        creative_priorities: [],
        creative_approach: approach,
      };
    },
    async directArt() {
      throw new Error("not used in this test");
    },
    async planSceneShot() {
      throw new Error("not used in this test");
    },
    async writeFlowPrompt() {
      throw new Error("not used in this test");
    },
  };
}

describe("CreativeStrategy — new fields are optional (backward compatible)", () => {
  it("an old-shape CreativeStrategy fixture (no creative_approach/scope_level) is still a valid CreativeStrategy", () => {
    const oldFixture: CreativeStrategy = {
      strategy_id: "strat_old",
      communication_direction: "informative",
      narrative_direction: "chronological",
      creative_priorities: ["clarity"],
    };
    expect(oldFixture.creative_approach).toBeUndefined();
    expect(oldFixture.scope_level).toBeUndefined();
  });
});

describe("runP203Strategize — memory-informed variation via priorApproaches", () => {
  it("threads priorApproaches through to the engine, reusing the existing memory read path", async () => {
    const engine = engineThatAvoidsRepetition();

    const withoutHistory = await runP203Strategize(engine, contentStructure, []);
    expect(withoutHistory.creative_approach).toBe("documentary");

    const withHistory = await runP203Strategize(engine, contentStructure, [], [memoryRecord("documentary")]);
    expect(withHistory.creative_approach).toBe("cinematic");

    // Two calls with different priorApproaches legitimately differ.
    expect(withoutHistory.creative_approach).not.toBe(withHistory.creative_approach);
  });
});
