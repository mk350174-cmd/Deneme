// Canonical Prompt Architecture — docs/architecture/02_PIPELINE_2_ARCHITECTURE.md
// "Canonical Prompt Architecture". Four layers:
//   1. Creative Intent            -> types.ts CreativeIntent
//   2. Structured Prompt Spec     -> types.ts PromptSpecification (stored)
//   3. Provider-specific renderer -> PromptRenderer (this file)
//   4. Google Flow prompt text    -> RenderedPrompt.prompt_text (this file)
//
// Layer 2 is provider-neutral and permanent/versioned; it must NEVER be
// mutated by rendering. GoogleFlowRenderer is ADAPTed from GRAFİK's
// google_flow_prompt_director.py assembly pattern, WITHOUT its 100-char
// field truncation (architecture doc: "No field is truncated").

import { stablePromptSpecId } from "./ids.js";
import type { AssetRequirement, ArtDirection, PromptSpecification, RenderedPrompt } from "./types.js";

export interface PromptRenderer {
  readonly provider: string;
  render(spec: PromptSpecification): RenderedPrompt;
}

const LABELED_FIELDS: Array<[keyof PromptSpecification, string]> = [
  ["subject", "Subject"],
  ["action", "Action"],
  ["environment", "Environment"],
  ["composition", "Composition"],
  ["camera", "Camera"],
  ["lighting", "Lighting"],
  ["motion", "Motion"],
  ["style", "Style"],
  ["materials", "Materials"],
  ["atmosphere", "Atmosphere"],
  ["continuity", "Continuity"],
];

export class GoogleFlowRenderer implements PromptRenderer {
  readonly provider = "google_flow";

  render(spec: PromptSpecification): RenderedPrompt {
    const lines: string[] = [];
    for (const [field, label] of LABELED_FIELDS) {
      const value = spec[field];
      if (typeof value === "string" && value.trim().length > 0) {
        lines.push(`${label}: ${value}`); // no truncation — full field text
      }
    }
    if (spec.negative_constraints.length > 0) {
      lines.push(`Negative constraints: ${spec.negative_constraints.join(", ")}`);
    }
    return {
      provider: this.provider,
      prompt_text: lines.join("\n"),
      rendered_at: new Date().toISOString(),
    };
  }
}

/**
 * Prompt Library — permanent, versioned, cross-project store of Layer 2
 * Prompt Specifications (never raw rendered text). Indexed by prompt_family
 * and axis_tags for retrieval, per the architecture doc.
 */
export interface PromptLibrary {
  store(spec: PromptSpecification): void;
  /** Latest stored version of a spec (or an exact version when given). */
  get(promptSpecId: string, version?: number): PromptSpecification | undefined;
  /** Every stored version of one spec, ascending by version. */
  versions(promptSpecId: string): PromptSpecification[];
  findByFamily(family: string): PromptSpecification[];
  findByAxisTags(tags: string[]): PromptSpecification[];
  all(): PromptSpecification[];
}

/**
 * TIER-2 REPAIR T2.3 — versioned prompt library.
 *
 * The contract calls the Prompt Library "permanent, versioned,
 * cross-project", and PromptSpecification carries a `version` field — but
 * the store was keyed on prompt_spec_id ALONE, so storing v2 of a spec
 * silently destroyed v1. A "versioned" library that cannot return a
 * historical version is not versioned.
 *
 * The canonical key is now `prompt_spec_id + version`, and re-storing an
 * identical (id, version) pair with DIFFERENT content is rejected rather
 * than silently overwriting history — version identity must not be reused
 * for different content.
 *
 * NOTE ON PERSISTENCE (honest scope statement): this implementation is, and
 * is named, IN-MEMORY. It is process-local and does not survive a restart.
 * The repair fixes the versioning defect, not the persistence one; see the
 * repair report's "Remaining issues" section.
 */
export class InMemoryPromptLibrary implements PromptLibrary {
  private readonly byKey = new Map<string, PromptSpecification>();

  private static key(id: string, version: number): string {
    return `${id}@${version}`;
  }

  store(spec: PromptSpecification): void {
    const key = InMemoryPromptLibrary.key(spec.prompt_spec_id, spec.version);
    const existing = this.byKey.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(spec)) {
      throw new Error(
        `PromptLibrary: version ${spec.version} of "${spec.prompt_spec_id}" is already stored with ` +
          "different content. A stored version is immutable — bump the version number instead of overwriting history.",
      );
    }
    this.byKey.set(key, spec);
  }

  get(promptSpecId: string, version?: number): PromptSpecification | undefined {
    if (version !== undefined) {
      return this.byKey.get(InMemoryPromptLibrary.key(promptSpecId, version));
    }
    const all = this.versions(promptSpecId);
    return all.length > 0 ? all[all.length - 1] : undefined;
  }

  versions(promptSpecId: string): PromptSpecification[] {
    return Array.from(this.byKey.values())
      .filter((s) => s.prompt_spec_id === promptSpecId)
      .sort((a, b) => a.version - b.version);
  }

  findByFamily(family: string): PromptSpecification[] {
    return this.all().filter((s) => s.prompt_family === family);
  }

  findByAxisTags(tags: string[]): PromptSpecification[] {
    const tagSet = new Set(tags);
    return this.all().filter((s) => s.axis_tags.some((t) => tagSet.has(t)));
  }

  all(): PromptSpecification[] {
    return Array.from(this.byKey.values());
  }
}

export function buildPromptSpecId(shotId: string, promptFamily: string): string {
  return stablePromptSpecId(shotId, promptFamily);
}

// P2-F: Generate individual visual generation prompts (one per asset).
// Each asset receives a custom PromptSpecification that references
// ArtDirection visual language, color palette, lighting, composition.
// Quality > batch processing: explicit per-asset prompt is superior to
// generic batch prompts.
// TIER-1 REPAIR T1.7: `decisionId` is now a REQUIRED argument.
//
// Previously this function hardcoded `decision_id: ""` with the comment
// "Filled by caller with decision_id" — but nothing filled it, and the
// empty string can never resolve against the decision log, so every prompt
// this function produced would be rejected by validateTraceabilityChain.
// (The function was unreferenced by the pipeline, which is the only reason
// the defect never fired in production; it is exported API and is fixed
// rather than left as a trap.)
//
// The generated prompt_spec_id is also derived from asset_requirement_id,
// not shot_id: a shot with several asset requirements previously produced
// colliding prompt ids whenever two requirements shared an asset_role.
export function generateIndividualAssetPrompts(
  assetRequirements: AssetRequirement[],
  artDirection: ArtDirection,
  decisionId: string,
): PromptSpecification[] {
  if (!decisionId || decisionId.trim().length === 0) {
    throw new Error(
      "generateIndividualAssetPrompts requires a real decision_id: a prompt must trace to an " +
        "approved creative decision (T1.7 lineage). Empty decision_id is never valid.",
    );
  }
  return assetRequirements.map((asset) => {
    const promptFamily = `flow.asset.${asset.asset_role || "visual"}`;
    const spec: PromptSpecification = {
      prompt_spec_id: stablePromptSpecId(asset.asset_requirement_id, promptFamily),
      version: 1,
      subject: `Asset for shot ${asset.shot_id}: ${asset.expected_media_type}`,
      action: undefined, // Caller-supplied; engine writes this per asset context
      environment: undefined,
      composition: `Composition aligned with art direction: ${artDirection.visual_language}`,
      camera: undefined, // Shot-level; not per-asset
      lighting: `Lighting per art direction: ${artDirection.visual_language}`,
      motion: undefined, // Caller-supplied; engine determines per asset
      style: `Style per art direction visual language: ${artDirection.visual_language}`,
      materials: undefined,
      atmosphere: undefined,
      continuity: `Continuity anchors: ${artDirection.checklist.join("; ")}`,
      negative_constraints: [],
      prompt_family: promptFamily,
      axis_tags: [asset.asset_role || "visual", asset.expected_media_type],
      traceable_to: {
        shot_id: asset.shot_id,
        asset_requirement_id: asset.asset_requirement_id,
        decision_id: decisionId,
      },
    };
    return spec;
  });
}
