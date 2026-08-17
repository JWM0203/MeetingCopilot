"""Dependency-free helpers for the MOSS ASR sidecar."""

from __future__ import annotations

import re


_SEGMENT_RE = re.compile(
    r"\[(?P<start>\d+(?:\.\d+)?)\]"
    r"\[(?P<speaker>S\d+)\]"
    r"(?P<text>.*?)"
    r"\[(?P<end>\d+(?:\.\d+)?)\]",
    re.DOTALL,
)


def transcript_text(raw: str) -> str:
    """Extract readable text from MOSS' ``[time][Sxx]text[time]`` output.

    The model is prompt-sensitive and may occasionally return plain text.  In
    that case preserve the text instead of dropping an otherwise useful ASR
    result.  Speaker labels are intentionally omitted because MeetingCopilot
    already keeps system audio and microphone audio on separate channels.
    """

    raw = (raw or "").strip()
    if not raw:
        return ""
    parts = [" ".join(m.group("text").split()) for m in _SEGMENT_RE.finditer(raw)]
    parts = [part for part in parts if part]
    if parts:
        return " ".join(parts)

    # Best-effort fallback for a malformed structured response.  Remove only
    # unambiguous scaffolding so bracketed natural-language content survives.
    cleaned = re.sub(r"\[(?:\d+(?:\.\d+)?|S\d+)\]", " ", raw)
    return " ".join(cleaned.split())


def max_new_tokens(audio_samples: int, sample_rate: int = 16_000) -> int:
    """Bound generation for a VAD-sized utterance without truncating speech."""

    seconds = max(0.0, audio_samples / float(sample_rate))
    return max(96, min(2048, int(seconds * 24) + 64))
