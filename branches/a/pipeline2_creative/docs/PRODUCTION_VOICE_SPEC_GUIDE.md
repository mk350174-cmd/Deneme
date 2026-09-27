# ElevenLabs + Piper Production-Spec Guide (P2.10)

Small-improvements addition (C7). Documentation only — no code/contract change, and P2 does **not** call ElevenLabs or Piper (that's P3's locked, gated path: `pipeline3_production/src/elevenlabs.ts`/`piper.ts`, already implemented and closed). This guide informs how P2.10 (`src/voiceSpec.ts`) prepares a higher-quality `voice_script`/`pronunciation_flags` production input for P3 to consume.

Researched against current official documentation (August 2026) per the plan's sourcing requirement: ElevenLabs from `elevenlabs.io/docs`, Piper from its official/primary repositories. Unconfirmed claims are marked as such rather than stated as fact.

## Part 1 — ElevenLabs (official: `elevenlabs.io/docs`)

### 1.1 Voice / model selection
ElevenLabs offers multiple TTS models with different quality/latency/cost trade-offs (Section 1.5). `eleven_multilingual_v2` targets highest-quality final production content and supports 29+ languages; Flash/Turbo variants trade some quality for lower latency and lower per-character cost. P3's `elevenlabs.ts` already uses `eleven_multilingual_v2` for production voice — this guide doesn't change that choice, only documents why it fits "final production" framing.

### 1.2 Voice settings: stability, similarity, style, speed
- **Stability**: controls consistency vs. emotional range. Lower values (~0.30–0.50) → more emotional/dynamic but occasionally less stable delivery; higher values (~0.60–0.85) → more consistent but can read as monotonous.
- **Similarity**: how closely the output adheres to the reference voice. If the reference audio is poor quality and similarity is set high, artifacts/background noise from the reference can be reproduced in the output.
- **Style**: an exaggeration setting (newer models) that amplifies the speaker's original style — official guidance is to change it minimally from default.
- **Speed**: default `1.0`; range roughly `0.7`–`1.2`. Most natural-sounding conversational speech sits around `0.9`–`1.1`. Official commonly-cited default starting point: stability ~50, similarity ~75, style ~0, then adjust minimally.
- **Recommendation for P2.10's production-spec output:** when a shot's narration is complex/technical, note a suggested *slower* speed in the spec; for routine narration, default speed is fine. This is exactly the kind of guidance `voiceSpec.ts`'s per-flag `note` field can carry.

### 1.3 Pronunciation control
- **Pronunciation dictionaries** (IPA or CMU alphabet) let a specific word/name be forced to a specific pronunciation. Phoneme-tag dictionary entries only take effect on `eleven_flash_v2` and `eleven_v3` — other models (including `eleven_multilingual_v2`, P3's current production model) skip phoneme tags and fall back to default pronunciation. **This is a real, actionable constraint**: `flagPronunciationRisks`'s special-terminology/date flags are only fixable via a pronunciation dictionary if the production model actually honors it — worth noting explicitly in any flag's guidance text rather than assuming the fix always applies.
- **Pauses**: the reliable mechanism on Multilingual v2 (P3's current model), Flash v2, and Flash v2.5 is the SSML `<break time="1.5s" />` tag. `eleven_v3` does **not** support SSML break tags. Excessive breaks can degrade audio quality (speed-up artifacts, added noise) — use sparingly.
- **Numbers/dates**: the API's `apply_text_normalization` parameter controls whether numbers/dates are spelled out for pronunciation. Official recommendation regardless of that flag: write numbers, dates, acronyms, and symbols out in words in the exact form you want spoken, rather than relying on normalization to guess correctly. This directly reinforces why `flagPronunciationRisks`'s number/date/unit flags exist — the guide's advice for resolving a flag should be "spell it out in words in `voice_script`," not "leave it numeric and hope."

### 1.4 Multilingual use & consistency
Multilingual v2 supports 29+ languages at 192kbps output and is positioned as the best-quality option for final production content. Voice consistency across multiple generations (e.g. across shots/scenes) benefits from keeping stability/similarity/style settings constant call-to-call — a drifting setting across shots is a plausible source of perceptible voice-character drift across a video, worth flagging in a production spec if a video spans many separate narration segments.

### 1.5 API / cost
- **Billing unit**: characters sent for synthesis, not resulting audio duration — a 500-character paragraph costs the same regardless of how long the output audio ends up being.
- **Per-model cost**: `eleven_multilingual_v2`-class models cost roughly 1 credit/character; Flash/Turbo-class models cost roughly 0.5 credits/character (i.e., roughly double the output for the same credit budget) — **[figures corroborated by multiple 2026 third-party pricing breakdowns plus ElevenLabs' own `elevenlabs.io/pricing`/`elevenlabs.io/pricing/api` pages; exact current numbers should still be re-checked at `elevenlabs.io/pricing` before being used for a hard budget decision, since pricing changes over time]**.
- P3's `preflight.ts` already estimates usage as `text.length` and enforces a hard cost limit before any call — this guide's role is upstream: keeping `voice_script` no longer than necessary (no filler, no redundant restatement) directly reduces P3's real cost, since cost scales with character count.

## Part 2 — Piper (official/primary: GitHub)

### 2.1 What it is
Piper is a fast, local, offline neural TTS engine built on the VITS architecture, exported to ONNX, with `espeak-ng` embedded for phonemization. No cloud service is required — this is why P3 uses it for the pre-approval preview step (Gate A5) ahead of the paid ElevenLabs production call.

### 2.2 Current development status — important, time-sensitive finding
**Active development has moved.** The original `rhasspy/piper` GitHub repository is the historically-known home, but as of this research pass (August 2026), active development lives at **`OHF-Voice/piper1-gpl`** (the Open Home Foundation's fork/continuation), with `pip install piper-tts` as the current install path and a recent `v1.6.0` release (July 2026) noted in search results. **Any future work referencing "the Piper repo" should point at `OHF-Voice/piper1-gpl`, not assume `rhasspy/piper` is still the maintained upstream** — this is exactly the kind of detail that goes stale in a model's training data and needed fresh verification.

### 2.3 Languages / voices
Piper supports 30+ languages/dialects (English US/UK, Arabic, Chinese, Spanish, French, and others), via ONNX voice models. Some voice models are multi-speaker (one model captures several speakers' styles) — multi-speaker models can switch speaker quickly but individual-speaker quality can be lower than a dedicated single-speaker model. Quality tiers range from `x_low` to `high` (16kHz–22.05kHz sample rate) — P3's own WAV parsing (`piper.ts`) doesn't currently branch on quality tier, so if a higher/lower-quality model is chosen, verify the resulting sample rate is still compatible with downstream timing math.

### 2.4 Model requirements, environment
Install via `pip install piper-tts`. Model files are ONNX voice models (obtained separately, e.g. from the `rhasspy/piper-voices` Hugging Face repo referenced by the project) — Piper the engine and the voice models are distributed separately. **Not confirmed in this research pass**: exact minimum hardware/OS requirements beyond "fast enough to run on a Raspberry Pi 4," which several sources repeat as a rough capability signal rather than a formal spec.

### 2.5 Failure modes / limitations
Not enumerated in a single official "known limitations" list found in this research pass — Piper's documentation is meaningfully thinner than a commercial API's (expected, per the plan's sourcing-priority note: official primary docs are used where they exist, and the gap is disclosed rather than papered over with invented failure modes). What P3's own `piper.ts` already encodes and tests against — the 15% duration-deviation threshold, non-zero subprocess exit codes, and WAV-header parsing failures — remains the actual, verified failure surface for this integration; this guide does not add new failure modes beyond what's already implemented and tested there.

### 2.6 Speed / timing
Piper is optimized for fast, local, real-time-capable synthesis (explicitly marketed as suitable for edge devices like the Raspberry Pi 4) — no official numeric latency benchmark was found in this research pass; see `pipeline3_production/docs/PIPER_CAPABILITY_PROFILE.md` (C8) for this environment's own directly-measured timing, which is the more reliable number for this project's actual use than a generic marketing claim.

## Sources

**Official (`elevenlabs.io/docs`, ElevenLabs' own site):**
- [Voice Settings](https://elevenlabs.io/docs/speech-synthesis/voice-settings) — Section 1.2.
- [Best practices](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices) — Sections 1.2–1.3.
- [Pronunciation dictionaries](https://elevenlabs.io/docs/eleven-agents/customization/voice/pronunciation-dictionary), [Using pronunciation dictionaries](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/pronunciation-dictionaries) — Section 1.3.
- [How can I add pauses?](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-can-i-add-pauses), [Do pauses and SSML phoneme tags work with the API?](https://help.elevenlabs.io/hc/en-us/articles/24352686926609-Do-pauses-and-SSML-phoneme-tags-work-with-the-API) — Section 1.3.
- [Why are numbers, dates, symbols and acronyms not properly pronounced?](https://elevenlabs.io/docs/help-center/product/speech-synthesis/text-to-speech/why-are-numbers-dates-symbols-and-acronyms-not-properly-pronounced-or-spoken-in-the-correct-language) — Section 1.3.
- [ElevenLabs Pricing](https://elevenlabs.io/pricing), [ElevenAPI Pricing](https://elevenlabs.io/pricing/api) — Section 1.5 (verify current numbers here before relying on them for a budget decision).

**Official/primary (Piper):**
- [github.com/rhasspy/piper](https://github.com/rhasspy/piper) — original repo, Sections 2.1, 2.3.
- [github.com/OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) — current active-development repo, Sections 2.2, 2.4.
- [rhasspy/piper-voices on Hugging Face](https://huggingface.co/rhasspy/piper-voices) — voice model distribution, Section 2.4.
- [piper/VOICES.md](https://github.com/rhasspy/piper/blob/master/VOICES.md) — voice list, Section 2.3.

**Secondary (used only for the per-character cost figures in Section 1.5, explicitly flagged as needing re-verification at the official pricing pages above):**
- Multiple 2026 third-party ElevenLabs pricing breakdowns surfaced during this research pass, cross-checked against each other for consistency but not individually authoritative.
