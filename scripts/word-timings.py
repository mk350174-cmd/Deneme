#!/usr/bin/env python3
"""Word-level timings for P3.F captions, via claude-code-video-toolkit's
tools/align_captions.py::transcribe_words (ElevenLabs Scribe).

    python3 scripts/word-timings.py <narration.wav|mp3> <out.json>     (Windows: python scripts\\word-timings.py …)

Needs: npm run setup:toolkit, the toolkit's Python deps (elevenlabs), and
ELEVENLABS_API_KEY. Output: [{"text","start","end"}, ...] — pass it to
`npm run unified -- finish ... --word-timings out.json`.
"""
import json, os, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
# Prefer the repo-local venv created by `npm run kur` / `npm run setup:extras`.
_venv = root / "tools" / ".venv"
_venv_py = _venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
# venv's bin/python is a symlink to the system interpreter, so compare prefixes, not executables
if _venv_py.exists() and Path(sys.prefix).resolve() != _venv.resolve() and not os.environ.get("UNIFIED_NO_REEXEC"):
    os.environ["UNIFIED_NO_REEXEC"] = "1"
    import subprocess
    sys.exit(subprocess.call([str(_venv_py), __file__, *sys.argv[1:]]))
tools = root / "tools" / "video-toolkit" / "tools"
if not (tools / "align_captions.py").exists():
    sys.exit("video-toolkit not installed — run: npm run setup:toolkit")
if len(sys.argv) != 3:
    sys.exit(__doc__)
def _key_from_dotenv():
    env = root / "branches" / "a" / "pipeline3_production" / ".env"
    if not env.exists():
        return None
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if line.startswith("ELEVENLABS_API_KEY"):
            _, _, v = line.partition("=")
            v = v.strip().strip("'\"").strip()
            if v and not v.startswith("<") and "your_" not in v:
                return v
    return None

key = os.environ.get("ELEVENLABS_API_KEY") or _key_from_dotenv()
if not key:
    sys.exit("ELEVENLABS_API_KEY yok — branches/a/pipeline3_production/.env içine ELEVENLABS_API_KEY=... yazın")
sys.path.insert(0, str(tools))
from align_captions import transcribe_words  # noqa: E402

words = transcribe_words(sys.argv[1], key)
Path(sys.argv[2]).write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{len(words)} words → {sys.argv[2]}")
