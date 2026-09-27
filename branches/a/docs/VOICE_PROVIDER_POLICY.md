# Voice Provider Policy: Piper → gTTS Fallback (NO Auto ElevenLabs)

## Canonical Fallback Chain

```
Tier 1 (Primary):   Piper (free, local, fast)
                      ↓ if unavailable/fails
Tier 2 (Fallback):  gTTS (Google Text-to-Speech, free, online)
                      ↓ if both fail
Stop here:          Return error to user
                      ↗ NO automatic escalation to ElevenLabs
```

## Piper (Tier 1 — Primary)

**Provider:** Open-source Piper (https://github.com/rhasspy/piper)

**Characteristics:**
- Free, open-source, local execution
- Offline (no internet required after model download)
- Multiple languages via ONNX models
- Turkish support: `tr_TR` model available
- Fast inference (seconds to minutes depending on text length)
- Deterministic output (same text → same audio)

**When used:**
- P3.04 Preview: Piper generates taslak (preview narration) for user review
- Default first choice for all production narration

**Output:** MP3/WAV file + measured duration in seconds

**Error handling:**
- If Piper unavailable (not installed, model missing, subprocess error)
  → Automatically try Tier 2 (gTTS)
- If Piper output duration ±15% of target → Flag for user review (not an error, just alert)

**Example:** 180-second Turkish philosophy video
```bash
python3 -m piper --model tr_TR-model.onnx --output_file narration.wav < script.txt
# Output: narration.wav (180s, deterministic)
```

---

## gTTS (Tier 2 — Fallback Only)

**Provider:** Google Text-to-Speech (free tier, public API)

**Characteristics:**
- Free, cloud-based, online
- Multiple languages via Google Cloud Speech-to-Text
- Turkish support: `tr` language code
- Requires internet connection (during fallback execution only)
- Slightly higher latency than Piper (network roundtrip)
- Deterministic per language setting

**When used:**
- P3.04 Preview ONLY: if Piper fails
- Never Tier 1, only fallback if Piper unavailable

**Output:** MP3 file + measured duration (real duration measured via `ffprobe` on the
generated audio — see "Real implementation" below; not an estimate from text length)

**Error handling:**
- If gTTS fails (network error, auth failure, quota exceeded)
  → Return error: "Both Piper and gTTS unavailable; cannot generate preview"
  → User must fix (restart Piper, check internet, retry)
  → NO automatic cascade to ElevenLabs

**Real implementation:** `runP304VoicePreviewWithFallback()` in `pipeline3_production/src/pipeline.ts` (backed by `runPiperPreview` in `piper.ts` and `runGttsPreview` in `gtts.ts`; the gTTS path uses the real `gtts` Python package via subprocess, not an estimate). See `tests/voiceFallback.p3c.test.ts` for the passing proof, including one real (non-fixture) network call to Google's TTS endpoint.

---

## ElevenLabs (Production Only, NOT Automatic)

**Provider:** ElevenLabs (https://elevenlabs.io)

**Status:** Production voice, ONLY with explicit user approval

**Characteristics:**
- Premium paid service (per-character charges)
- High-quality voice synthesis
- Multiple voice options (gender, tone, accent)
- Requires API key + account balance
- Turkish support (multiple voice options)

**When used:**
- P3.05 Production voice: ONLY if user explicitly approves at Gate A5
- Never automatic, never fallback escalation
- User controls provider choice + voice variant

**Gate A5 Decision:**
1. User reviews Piper preview (or gTTS preview if Piper failed)
2. User approves preview or requests re-generation
3. At Gate A5, user explicitly chooses:
   - "Use Piper for production" (same as preview) → no ElevenLabs needed
   - "Use ElevenLabs" → select voice, tone, pacing → system executes at cost
4. NO automatic "upgrade to ElevenLabs" based on preview quality or cost logic

**Error handling:**
- ElevenLabs API errors → reported to user at Gate A5
- User must fix (API key, balance, network) and retry
- Preview doesn't cascade; user makes conscious choice for production

---

## Workflow: Preview → Approval → Production

### Phase 1: Generate Preview (P3.04)

```
User provides: narration script + target duration

System tries:
  1. Piper → success → return preview
  2. Piper → fails → try gTTS
     2a. gTTS → success → return preview
     2b. gTTS → fails → return error

Gate A5 not yet triggered; preview only.
```

**Real implementation** (`pipeline3_production/src/pipeline.ts`):
```typescript
export async function runP304VoicePreviewWithFallback(
  params: { text: string; piperOutputPath: string; gttsOutputPath: string; modelPath: string; language: string; targetDurationS: number },
  cache: StageCache,
  costLedger: CostLedger,
  execPiper: ExecPiperSubprocess = defaultExecPiperSubprocess,
  execGtts: ExecGttsSubprocess = defaultExecGttsSubprocess,
): Promise<VoicePreviewResult> {
  try {
    return await runP304PiperPreview({ text: params.text, outputPath: params.piperOutputPath, modelPath: params.modelPath, targetDurationS: params.targetDurationS }, cache, costLedger, execPiper);
  } catch (piperError) {
    try {
      return await runP304GttsFallbackPreview({ text: params.text, outputPath: params.gttsOutputPath, language: params.language, targetDurationS: params.targetDurationS }, cache, costLedger, execGtts);
    } catch (gttsError) {
      throw new Error(`P3.04 voice preview failed on both tiers — Piper: ${piperError.message} | gTTS: ${gttsError.message}. No automatic ElevenLabs fallback...`);
    }
  }
}
```
Both tiers are cached (StageCache) and cost-logged (CostLedger, provider `"piper"` or `"gtts"`, both `unit_cost: 0`). Returns `VoicePreviewResult` — either Piper's or gTTS's result. gTTS never runs if Piper succeeds.

### Phase 2: User Reviews + Gate A5 Decision

User listens to preview (Piper or gTTS) and decides. There is exactly one
gate-state name here, not one per provider — `approvePiperPreview()`
(`voiceApproval.ts`) always records Gate A5 as `NARRATION_APPROVED_FOR_PRODUCTION`,
regardless of which provider produced the approved preview:

```
User choice 1: Approve preview as final narration (Piper or gTTS)
  → approvePiperPreview(preview, actor) records Gate A5 = NARRATION_APPROVED_FOR_PRODUCTION
  → The approved preview's audio file IS the production narration.
  → runP305ElevenLabsProductionVoice() is simply never called — Piper/gTTS
    have no separate "preview vs. production" distinction the way
    ElevenLabs does (which bills per character and needs its own call).

User choice 2: Request ElevenLabs production voice instead
  → Gate A5 is still recorded as NARRATION_APPROVED_FOR_PRODUCTION (approving
    the preview is what unlocks the ElevenLabs call in the first place —
    see elevenlabs.ts's invariant 8).
  → Caller then explicitly invokes runP305ElevenLabsProductionVoice(), which
    re-checks Gate A5 == NARRATION_APPROVED_FOR_PRODUCTION unconditionally
    before making the real paid API call (and Gate A6 too, if material
    ambiguity was flagged by the ElevenLabs preflight).
  → Charged per character (see costLedger provider: "elevenlabs").

User choice 3: Request re-generation with the same provider
  → Stay at P3.04, regenerate the preview with different parameters.
  → Re-try the Gate A5 decision.
```

### Phase 3: Production Voice

There is no `generateProductionVoice(gate, preview)` dispatcher in this
codebase — the real control flow is simpler than that:

- If the user is satisfied with the Tier 1/2 preview, its audio file is used
  as-is; nothing further is called.
- If the user wants ElevenLabs, the caller invokes
  `runP305ElevenLabsProductionVoice()` (`pipeline.ts`) directly. That
  function enforces Gate A5 (and A6, if applicable) internally — see
  `elevenlabs.ts` and `pipeline.ts`'s `runP305ElevenLabsProductionVoice`.

---

## No Automatic Cascade Policy

**NEVER:**
- Automatically upgrade preview provider (Piper → ElevenLabs without user asking)
- Escalate gTTS to ElevenLabs if preview quality insufficient
- Auto-select ElevenLabs based on cost or duration
- Use ElevenLabs as "better fallback" if Piper/gTTS underperform

**ALWAYS:**
- Piper first, gTTS fallback if Piper unavailable
- Stop at gTTS failure; error out with clear message
- Let user decide ElevenLabs at Gate A5 (explicit approval)
- Respect user's Gate A5 choice (Piper/gTTS/ElevenLabs) for production

---

## Test Cases (P3-C)

Real, passing tests — `pipeline3_production/tests/voiceFallback.p3c.test.ts`
(against the real `runP304VoicePreviewWithFallback` orchestration function):

- Tier 1 success: returns the Piper result; gTTS seam is never invoked.
- Tier 1 fails, Tier 2 succeeds: automatically falls back, returns a
  gTTS-tagged result.
- Both tiers fail: throws, naming both providers' real error messages, and
  explicitly stating there is no automatic ElevenLabs fallback.
- CostLedger logs reflect exactly which tier actually ran.
- One test exercises the REAL gTTS implementation (network call to Google's
  TTS endpoint, no fixture) and verifies the output is a real, decodable
  MP3 file — not an estimated duration with no audio.

`pipeline3_production/tests/voice.p3c.test.ts` additionally unit-tests
`runPiperPreview`/`runGttsPreview` in isolation (deviation-flagging, result
shape, etc.) — see the note at the top of that file for what it does and
does not prove about the integrated fallback policy.

### Gate A5 Decision: Approve Preview, Use It As Final Narration
```
User approves preview (Piper or gTTS) via approvePiperPreview()
  → Gate A5 state_after: "NARRATION_APPROVED_FOR_PRODUCTION"
  → runP305ElevenLabsProductionVoice() is never called
  → The preview's own audio file is the production narration
```

### Gate A5 Decision: Approve Preview, Then Request ElevenLabs
```
User approves preview via approvePiperPreview() (same single gate state)
  → Caller then explicitly calls runP305ElevenLabsProductionVoice()
  → That call re-checks Gate A5 == NARRATION_APPROVED_FOR_PRODUCTION before
    making the real API call (elevenlabs.ts, invariant 8)
  → User charged per character (costLedger provider: "elevenlabs")
```

---

## Error Messages (User-Facing)

### Piper Unavailable
```
"Piper TTS unavailable (model not found or not installed). 
 Attempting fallback: Google Text-to-Speech..."
```

### Both Fail
```
"Unable to generate narration preview:
 - Piper unavailable (local inference failed)
 - gTTS unavailable (network error or quota exceeded)
 
 Please fix and retry:
 1. Check Piper installation: python3 -m pip install piper-tts
 2. Download Turkish model: piper download tr_TR
 3. Check internet connection for gTTS fallback
 4. Retry narration generation"
```

### Gate A5 ElevenLabs Choice
```
"Production voice: ElevenLabs selected
 Voice: [user choice]
 Estimated cost: [characters × rate]
 Proceeding with production generation..."
```

---

## Summary

| Tier | Provider | Primary Use | Fallback? | Auto Escalate | Cost |
|------|----------|------------|-----------|---------------|------|
| 1 | Piper | Preview (default) | No | No | Free |
| 2 | gTTS | Preview (if Piper fails) | Yes | No | Free |
| 3 | ElevenLabs | Production (user choice at Gate A5) | No | **Never** | Paid |

**Core rule:** Piper → gTTS → STOP (no automatic ElevenLabs). User controls ElevenLabs at Gate A5.
