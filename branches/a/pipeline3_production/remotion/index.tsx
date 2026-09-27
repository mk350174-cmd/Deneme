// Real Remotion root entry (registerRoot) — replaces the previous code's
// incorrect reuse of src/index.ts (the library's plain barrel export, not
// a Remotion entry) as the render target. This is the ONLY Remotion entry
// in this repo (AUDIT FIX §13.5).

import { Composition, registerRoot } from "remotion";
import { P3Composition } from "./P3Composition";
import type { P3CompositionProps } from "./P3Composition";

const DEFAULT_PROPS: P3CompositionProps = {
  timeline: { fps: 30, total_frames: 30, entries: [] },
  assetPaths: {},
};

const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="P3Timeline"
      component={P3Composition}
      durationInFrames={DEFAULT_PROPS.timeline.total_frames}
      fps={DEFAULT_PROPS.timeline.fps}
      width={1080}
      height={1920}
      defaultProps={DEFAULT_PROPS}
      calculateMetadata={async ({ props }) => {
        const p = props as P3CompositionProps;
        return {
          durationInFrames: Math.max(1, p.timeline.total_frames),
          fps: p.timeline.fps,
        };
      }}
    />
  );
};

registerRoot(RemotionRoot);
