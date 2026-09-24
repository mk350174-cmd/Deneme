# Google Flow / Artifact Playbook (P2.09)

Small-improvements addition (C6). Documentation only — no code/contract change. This guide informs how P2.09 (`src/promptArchitecture.ts`) prepares Structured Prompt Specifications for a human operator to use manually in Google Flow. P2 does not call Flow's API and does not automate Flow.

Researched against current official Google sources (August 2026) per the plan's sourcing requirement. Claims not confirmed against an official source are marked **[unconfirmed]** rather than stated as fact.

## 1. What Google Flow is

Google Flow is Google's AI filmmaking tool, built for Google's generative models (Veo for video, Imagen/Nano Banana for images, Gemini for text/brainstorming). As of a February 2026 update, Flow was merged with Whisk AI and ImageFX into one unified creative workspace **[secondary source — see below; not confirmed on an official Google page in this research pass]**.

**Access requirements (official):** age 18+ with verified age, a supported region, a Google AI Plus/Pro/Ultra subscription (or a qualifying Workspace plan), and a Chromium-based desktop browser for the best experience.

## 2. Capabilities (by model)

Flow exposes several underlying models, each with different capabilities (official, `support.google.com/flow` → *Learn about Google Flow models & supported features*):

- **Veo 3.1** (Lite / Fast / Quality variants): text-to-video, frame-to-video (first frame, or first+last frame), both aspect ratios at 4s/6s/8s (Fast/Quality also support 10s for some features), an Ingredients/References feature limited to 8s videos, and video extension (Lite only, 8s videos).
- **Gemini Omni Flash**: exclusive capabilities — video up to 10s, video-to-video editing with a new prompt, custom voice creation from preset voices, advanced character/avatar and audio references. Some of its features have geographic restrictions.
- **Image models**: Nano Banana Pro (complex designs), Nano Banana 2 Lite (free default), Nano Banana 2 (standard fast generation).
- If a selected feature isn't supported by the current model, Flow notifies the user rather than silently failing — worth knowing when planning a shot that needs a specific capability.

## 3. Prompt structure

Official guidance: Flow "understands plain English — no special keywords, no weighting, no negative prompts needed" **[from a Google Flow prompting resource found in this research pass — not a `support.google.com` page; treat as secondary-but-Google-affiliated and verify against `support.google.com/flow` before relying on it]**. The core structure for both image and video prompts: **subject, action/movement, environment/setting, lighting, style**; video prompts additionally need **camera movement** instructions and, separately, **audio direction**. A working prompt length range reported by the same source is roughly 30–80 words.

This maps directly onto P2's own Structured Prompt Specification (Layer 2, `promptArchitecture.ts`): `subject`, `action`, `environment`, `camera`, `lighting`, `motion`, `style` are already the canonical fields — Flow's own expected prompt shape and P2's Layer 2 schema are already aligned. No change is needed to Layer 2 for this reason; this is a confirmation, not a new requirement.

## 4. Reference usage ("Ingredients")

**Official:** reference images/videos are called **Ingredients** in Flow. Drag a reference in, or use "Add" under the prompt box. Reference a named ingredient in the prompt text directly (e.g. "the woman, whose torso is the lava lamp, ..."), or address a character with `@Name` / a personal avatar with `@me`. For best results, provide subject/product references on a plain or segmented background. Ingredients are what carries visual continuity of a character or object across separate clips.

**Continuity:** consistency across clips is carried by (a) reusing the same Ingredient references, (b) `@`-addressing the same named character, and (c) for Gemini Omni Flash, single-speaker voice references that persist a specific character's voice across videos — voice references only work with ingredient-based generations (an error is raised otherwise).

## 5. Camera / shot approach

**Official:** camera motion is set via a dedicated **Camera Motion** control in the UI, separate from the free-text prompt. When authoring a Structured Prompt Specification for a human to hand-enter into Flow, the `camera` field content should be written so it can be applied both as prompt text and cross-checked against Flow's own Camera Motion picker — don't rely on text alone if the picker offers the same control directly.

## 6. Frames, transitions, image/video generation

Flow supports **first-frame** or **first+last-frame** video generation — supplying a start frame and (optionally) an end frame, then describing the transition/action between them in the prompt. Generated stills can be iteratively refined (e.g. via the Nano Banana image model), added to the Ingredients drawer, and reused as frames or elements in later video generations.

## 7. Iteration

Flow integrates with Gemini for prompt brainstorming/refinement, and its **Flow Agent** mode can generate multiple prompt variations in one pass — useful for exploring several Google-Flow-text renderings (Layer 4) from the same underlying Prompt Specification (Layer 2) without touching the stored, provider-neutral spec itself.

## 8. Limitations (official)

- All outputs carry an invisible SynthID watermark; a *visible* watermark is applied automatically for users in India, South Korea, and Vietnam.
- Generation may be rate-limited, particularly for zero-credit models.
- Harmful/illegal/inappropriate content generation is prohibited; extra precautions apply to minors and uploaded photos of real people.
- Voice references (Gemini Omni Flash) only work with ingredient-based generations.
- Model costs "are evolving fast" — check the current cost in-product at generation time rather than assuming a fixed number.

## 9. Troubleshooting

- If a requested feature isn't available on the currently selected model, Flow tells you — check the model/feature match (Section 2) before assuming a bug.
- Poor-quality or noisy reference audio/images can carry that noise into the generation when similarity/adherence to the reference is high — same principle P3's ElevenLabs guidance (Section 3 of `PRODUCTION_VOICE_SPEC_GUIDE.md`) applies to voice references.
- Some Gemini Omni Flash capabilities are geographically restricted — confirm regional availability before planning a shot around them.

## 10. "Artifact" usage — explicit finding

The brief asked this guide to also cover "Artifact" usage. Direct research finding: **no feature literally named "Artifact" appears in the official `support.google.com/flow` pages fetched for this guide** (Get Started, Models & Features, Create Videos). One non-official, aggregated source describes Flow's imported/generated characters, scenes, images, and other visual elements informally as "artifacts" — i.e., a generic term for "the creative assets you work with in Flow," not a distinct named feature with its own UI/API. **This is marked unconfirmed** rather than documented as a real Flow feature. If "Artifact" refers to something more specific (e.g. a particular panel or export format), that needs a follow-up, more targeted lookup against `support.google.com/flow` directly — not guessed here.

## Sources

**Official (`support.google.com/flow`, fetched directly this session):**
- [Get started with Google Flow](https://support.google.com/flow/answer/16353333?hl=en) — access requirements, getting started.
- [Learn about Google Flow models & supported features](https://support.google.com/flow/answer/16352836?hl=en) — Section 2 (capabilities by model).
- [Create videos in Google Flow](https://support.google.com/flow/answer/16353334?hl=en) — Sections 3–7 (prompt structure, ingredients, continuity, frames, iteration).

**Official (Google's own blog, not `support.google.com`):**
- [Introducing Flow: Google's AI filmmaking tool designed for Veo](https://blog.google/innovation-and-ai/products/google-flow-veo-ai-filmmaking-tool/)
- [5 tips for using Flow, Google's AI filmmaking tool](https://blog.google/innovation-and-ai/products/flow-video-tips/)

**Secondary (used only where official sources didn't cover a point, explicitly flagged above wherever relied upon):**
- Third-party prompting/feature-overview articles surfaced during this research pass (e.g. whiskailabs.net, imaginego.ai, blog.designhero.tv) — used only for the prompt-length-range note (Section 3) and the "Artifact" terminology discussion (Section 10), both explicitly marked as unconfirmed/secondary above.
