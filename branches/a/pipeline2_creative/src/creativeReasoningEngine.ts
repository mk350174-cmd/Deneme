// Creative Reasoning Engine Contract — docs/architecture/02_PIPELINE_2_ARCHITECTURE.md
// "Creative Reasoning Engine Contract (provider remains deferred)". The
// interface below matches the architecture's 5 methods exactly. The concrete
// provider is NOT selected here — this stays deferred per the approved
// architecture.
//
// ManualCreativeReasoningEngine is a deterministic TEST/REFERENCE ADAPTER
// ONLY — analogous to pipeline1_research's ManualResearchEngine — NOT a
// committed engine decision. It never invents anything: every output is
// grounded in what the caller explicitly supplies (research package claims,
// user goals, references, memory). Anything not grounded surfaces as an
// explicit gap/proposal, never a silent invention (Architectural Principles
// 4 and 5).

import type {
  ArtDirection,
  ContentStructure,
  CreativeStrategy,
  Decision,
  MemoryRecord,
  PromptSpecification,
  Reference,
  ResearchPackageHandoffInput,
  Scene,
  Shot,
} from "./types.js";
import type { PromptLibrary } from "./promptArchitecture.js";

export interface CreativeReasoningEngine {
  understand(researchPackage: ResearchPackageHandoffInput, references: Reference[]): Promise<ContentStructure>;
  // priorApproaches (C3, small improvements): optional memory records (e.g.
  // from the CREATIVE_HISTORY/AVOID_MEMORY/REJECTION_MEMORY buckets) an
  // engine MAY consult to inform deliberate variation vs. repetition when
  // choosing creative_approach. Reuses memory.ts's existing read path —
  // no new storage mechanism. Optional, so this stays additive.
  strategize(contentStructure: ContentStructure, userGoals: string[], priorApproaches?: MemoryRecord[]): Promise<CreativeStrategy>;
  directArt(
    strategy: CreativeStrategy,
    references: Reference[],
    memory: MemoryRecord[],
  ): Promise<{ artDirection: ArtDirection; decisionLog: Decision[] }>;
  planSceneShot(strategy: CreativeStrategy, artDirection: ArtDirection): Promise<{ scenes: Scene[]; shots: Shot[] }>;
  writeFlowPrompt(shot: Shot, artDirection: ArtDirection, library: PromptLibrary): Promise<PromptSpecification>;
}

export interface ManualEngineFixtures {
  contentStructure: ContentStructure;
  creativeStrategy: CreativeStrategy;
  artDirection: ArtDirection;
  decisionLog: Decision[];
  scenes: Scene[];
  shots: Shot[];
  // Keyed by shot_id — a pre-authored PromptSpecification per shot. A shot
  // with no entry here has no data to ground a prompt on, and
  // writeFlowPrompt throws rather than inventing one.
  promptSpecsByShotId: Record<string, PromptSpecification>;
}

export class ManualCreativeReasoningEngine implements CreativeReasoningEngine {
  constructor(private readonly fixtures: ManualEngineFixtures) {}

  async understand(): Promise<ContentStructure> {
    return this.fixtures.contentStructure;
  }

  async strategize(): Promise<CreativeStrategy> {
    return this.fixtures.creativeStrategy;
  }

  async directArt(): Promise<{ artDirection: ArtDirection; decisionLog: Decision[] }> {
    return { artDirection: this.fixtures.artDirection, decisionLog: this.fixtures.decisionLog };
  }

  async planSceneShot(): Promise<{ scenes: Scene[]; shots: Shot[] }> {
    return { scenes: this.fixtures.scenes, shots: this.fixtures.shots };
  }

  async writeFlowPrompt(shot: Shot): Promise<PromptSpecification> {
    const spec = this.fixtures.promptSpecsByShotId[shot.shot_id];
    if (!spec) {
      throw new Error(
        `ManualCreativeReasoningEngine has no PromptSpecification fixture for shot "${shot.shot_id}" — ` +
          `refusing to invent one.`,
      );
    }
    return spec;
  }
}
