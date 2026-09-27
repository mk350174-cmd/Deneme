// The unified production cycle as data. Used by the CLI `plan` command and by
// tests, and mirrored in docs/UNIFIED_ARCHITECTURE.md. One entry per stage,
// in execution order. `owner` is the ONLY system allowed to perform the stage.

export type Owner = "A-P1" | "B" | "A-P2" | "A-P3" | "YT" | "BRIDGE";

export interface CycleStage {
  id: string;
  owner: Owner;
  name: string;
  input: string;
  output: string;
  human_gate?: string;
}

export const UNIFIED_CYCLE: readonly CycleStage[] = [
  { id: "S01", owner: "A-P1", name: "Research P1.01–P1.07", input: "topic, question, user materials", output: "ResearchPackageHandoff", human_gate: "A1 scope + package approval" },
  { id: "S02", owner: "BRIDGE", name: "Bridge 1 — research → strategy inputs", input: "ResearchPackageHandoff (A1)", output: "StrategyInputBundle (sealed)" },
  { id: "S03", owner: "B", name: "B01 ecosystem / brand / channels (orchestrator: b-propose preview)", input: "StrategyInputBundle.b01_input + owner StrategyBrief", output: "B01 canonical", human_gate: "b-propose review → b-commit decisions (per-module approval)" },
  { id: "S04", owner: "B", name: "B02 opportunities, B03 audience (+ Agent Reach YouTube search / RSS via B08)", input: "B01 + b03_audience_sources + reach intelligence + prior-cycle B08 intelligence", output: "B02/B03 canonical", human_gate: "per-module approval" },
  { id: "S05", owner: "B", name: "B04 territory, B05 creative angles/brief, B06 distribution/format", input: "B01–B03", output: "B04–B06 canonical", human_gate: "per-module approval" },
  { id: "S06", owner: "B", name: "B07 KPIs, B08 analytics plan, B09/B10 learning, B11 compliance", input: "B04–B10 + YouTube learning feed (prior cycle)", output: "B07–B11 canonical", human_gate: "B10 proposals require approval" },
  { id: "S07", owner: "B", name: "B12 branch snapshot + commit", input: "B01–B11 canonical", output: "BranchCanonicalState (committed)", human_gate: "G-B: commitBranchState by channel owner" },
  { id: "S08", owner: "BRIDGE", name: "Bridge 2 — committed strategy → creative directive", input: "StrategyInputBundle + committed B12 + B05/B06/B07/B11(+B10)", output: "StrategicCreativeDirective (sealed)" },
  { id: "S09", owner: "A-P2", name: "Creative P2.01–P2.11 (goals/format/memory from directive)", input: "ResearchPackageHandoff + directive", output: "ProductionPackageHandoff (frozen)", human_gate: "A2 references/art direction, A3 package approval" },
  { id: "S10", owner: "A-P3", name: "Production P3.01–P3.10 (Flow assets, ElevenLabs, Remotion)", input: "ProductionPackageHandoff", output: "FinalDeliveryPackage + MP4", human_gate: "A4 ingest, A5/A6 voice, A7 final QA" },
  { id: "S10F", owner: "A-P3", name: "P3.F finishing — burned captions, ducked music bed (ffmpeg; toolkit supplies music/word timings)", input: "A7-approved master + P2 voice_lines (+ licensed music, word timings)", output: "FinishingRecord + finished MP4 + SRT", human_gate: "F1: owner watches the finished file" },
  { id: "S11", owner: "BRIDGE", name: "Bridge 3 — final delivery (or F1-approved finish) → YouTube import", input: "FinalDeliveryPackage + P2 package + P1 package + directive (+ FinishingRecord + F1)", output: "YouTubeImportPackage (sealed)" },
  { id: "S12", owner: "YT", name: "Import, DarkzSEO preflight, Review Studio", input: "YouTubeImportPackage", output: "production awaiting approval", human_gate: "fact review, media rights, synthetic disclosure, SEO, approval" },
  { id: "S13", owner: "YT", name: "Schedule & publish; Shorts repurposing; growth experiments", input: "approved production", output: "published video(s)", human_gate: "publish time/privacy; experiment start & winner" },
  { id: "S14", owner: "YT", name: "Analytics (24h/7d), retention, comment sync", input: "published video", output: "performance_snapshots, engagement_insights" },
  { id: "S15", owner: "BRIDGE", name: "Bridge 4 — learning feed → B08 intelligence", input: "LearningFeed + KpiBindings", output: "ExternalIntelligenceContext" },
  { id: "S16", owner: "B", name: "Next cycle: B07 actuals, B03 audience, B09 signals → B10 proposals", input: "ExternalIntelligenceContext + reviews", output: "approved proposals → next directive memory", human_gate: "independent observation review; B10 approval" },
] as const;

/** Capability ownership: which system is authoritative for each capability. */
export const CAPABILITY_OWNERSHIP: Readonly<Record<string, { owner: Owner; disabled_duplicates: string[] }>> = {
  topic_research: { owner: "A-P1", disabled_duplicates: ["YT content-strategy-agent trend research (for this lane)"] },
  channel_strategy: { owner: "B", disabled_duplicates: ["YT Autonomous Channel Operator", "YT weekly strategy review"] },
  audience_insight: { owner: "B", disabled_duplicates: [] },
  creative_direction: { owner: "A-P2", disabled_duplicates: ["YT script-writer-agent"] },
  visual_generation: { owner: "A-P3", disabled_duplicates: ["YT ai-video-generator / video-providers"] },
  narration: { owner: "A-P3", disabled_duplicates: ["YT TTS narration", "video-toolkit qwen3_tts (no Turkish)"] },
  market_intelligence: { owner: "B", disabled_duplicates: ["Agent Reach cookie/browser-session channels (not integrated)"] },
  finishing_captions_music: { owner: "A-P3", disabled_duplicates: ["video-toolkit templates/Remotion scenes", "video-toolkit dewatermark (forbidden)"] },
  render: { owner: "A-P3", disabled_duplicates: ["YT ffmpeg assembly (except Shorts repurposing)"] },
  discoverability_seo: { owner: "YT", disabled_duplicates: [] },
  review_and_publish: { owner: "YT", disabled_duplicates: ["A P3.10 Kaggle delivery as publication (remains archival)"] },
  shorts_repurposing: { owner: "YT", disabled_duplicates: [] },
  growth_experiments: { owner: "YT", disabled_duplicates: [] },
  analytics_collection: { owner: "YT", disabled_duplicates: [] },
  learning_and_optimization: { owner: "B", disabled_duplicates: ["YT learning recommendations as a strategy source (kept as advisory)"] },
  compliance: { owner: "B", disabled_duplicates: [] },
};
