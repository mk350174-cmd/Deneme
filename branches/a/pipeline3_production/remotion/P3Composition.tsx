// AUDIT FIX (P3 final closure pass, §13.5 + correction 2) — the ONE
// canonical Remotion composition (no duplicate/superseded composition,
// per the architecture doc's explicit exclusion). Mechanical frame
// assembly only: it consumes the already-approved Timeline and resolved
// real asset files, and lays them out at the timeline's own declared
// frame boundaries. It never invents, reinterprets, or chooses creative
// content — "Remotion executes the approved timeline."

import { AbsoluteFill, Img, OffthreadVideo, Sequence, staticFile } from "remotion";
import { buildSequenceDescriptors } from "./compositionHelpers";
import type { P3Timeline } from "./compositionHelpers";

export type { P3Timeline, P3TimelineEntry } from "./compositionHelpers";

export interface P3AssetRef {
  // asset_file_id — resolved to a real, servable URL via Remotion's own
  // staticFile() (bundle()'s publicDir maps the real staging directory
  // through the SAME http origin the composition is served from; a raw
  // filesystem path or file:// URL is rejected by Chrome — verified via a
  // real render smoke test).
  path: string;
  // Authoritative media-kind signal, taken from the resolved asset's own
  // media_properties.type — NOT inferred from a file extension, since the
  // asset_file_id identity convention used elsewhere in this pipeline is
  // deliberately extensionless.
  is_video: boolean;
}

export interface P3CompositionProps {
  timeline: P3Timeline;
  // asset_file_id -> real, already-staged asset reference (correction 2) —
  // resolved deterministically via assetStaging.ts's resolveAssetFilePath,
  // never a filename/order/timestamp heuristic. Absent entries render as a
  // plain labeled placeholder block (e.g. the asset genuinely isn't staged
  // yet in this run) rather than crashing the composition.
  assetPaths: Record<string, P3AssetRef>;
}

export const P3Composition: React.FC<P3CompositionProps> = ({ timeline, assetPaths }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {buildSequenceDescriptors(timeline).map((seq) => {
        const asset = assetPaths[seq.asset_file_id];
        return (
          <Sequence key={seq.shot_id} from={seq.from} durationInFrames={seq.durationInFrames}>
            <AbsoluteFill style={{ backgroundColor: seq.color }}>
              {asset ? (
                asset.is_video ? (
                  <OffthreadVideo src={staticFile(asset.path)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <Img src={staticFile(asset.path)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                )
              ) : (
                // UNIFIED FIX (2026-09-23, MERGE_REPORT Güncelleme 7): the identifying label belongs to
                // the placeholder block only (see P3CompositionProps.assetPaths). Previously it was drawn
                // over EVERY frame, burning "shot · asset · Nf" into finished videos.
                <div
                  style={{
                    position: "absolute", bottom: 24, left: 24, zIndex: 1,
                    background: "rgba(0,0,0,0.55)", color: "white", padding: "8px 14px",
                    fontFamily: "sans-serif", fontSize: 28, borderRadius: 6,
                  }}
                >
                  {seq.shot_id} · {seq.asset_file_id} · {seq.durationInFrames}f
                </div>
              )}
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
