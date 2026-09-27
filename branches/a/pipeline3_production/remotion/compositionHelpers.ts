// Pure, JSX-free data-shaping helpers for P3Composition.tsx — kept in a
// plain .ts file specifically so they can be hermetically unit-tested
// (tests/remotionComposition.test.ts) without a JSX/DOM test environment,
// a bundler, or a real browser.

export function colorForShot(shotId: string): string {
  let hash = 0;
  for (let i = 0; i < shotId.length; i += 1) hash = (hash * 31 + shotId.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 55%, 40%)`;
}

// Extension-based classification — a legitimate fallback for staged files
// that DO carry a real extension, but NOT the authoritative signal: the
// asset_file_id identity convention used elsewhere in this pipeline is
// extensionless (e.g. "file_wide_arch_001"), so the composition's primary
// signal is the resolved asset's own media_properties.type (see
// AssetRef.is_video below), not this function.
export function isVideoPath(p: string): boolean {
  return /\.(mp4|mov|webm|mkv)$/i.test(p);
}

export interface P3TimelineEntry {
  shot_id: string;
  asset_file_id: string;
  start_frame: number;
  duration_frames: number;
}

export interface P3Timeline {
  fps: number;
  total_frames: number;
  entries: P3TimelineEntry[];
}

// Pure mapping from a Timeline to the sequence descriptors the composition
// renders one <Sequence> per — kept separate from the JSX itself so the
// "does the composition correctly consume the Timeline contract" question
// is testable without ever touching React/Remotion runtime.
export interface SequenceDescriptor {
  shot_id: string;
  asset_file_id: string;
  from: number;
  durationInFrames: number;
  color: string;
}

export function buildSequenceDescriptors(timeline: P3Timeline): SequenceDescriptor[] {
  return timeline.entries.map((entry) => ({
    shot_id: entry.shot_id,
    asset_file_id: entry.asset_file_id,
    from: entry.start_frame,
    durationInFrames: Math.max(1, entry.duration_frames),
    color: colorForShot(entry.shot_id),
  }));
}
