import unittest

from tools.moss_asr_utils import max_new_tokens, transcript_text


class TranscriptTextTests(unittest.TestCase):
    def test_extracts_one_structured_segment(self):
        raw = "[0.00][S01]你好，欢迎参加会议。[2.40]"
        self.assertEqual(transcript_text(raw), "你好，欢迎参加会议。")

    def test_joins_multiple_speakers_without_protocol_labels(self):
        raw = "[0.10][S01]Hello there.[1.20][1.30][S02]Hi back.[2.00]"
        self.assertEqual(transcript_text(raw), "Hello there. Hi back.")

    def test_preserves_plain_text_fallback(self):
        self.assertEqual(transcript_text("  plain   transcript  "), "plain transcript")

    def test_strips_malformed_scaffolding(self):
        self.assertEqual(transcript_text("[0.0][S01]useful text"), "useful text")


class MaxNewTokensTests(unittest.TestCase):
    def test_bounds_generation(self):
        self.assertEqual(max_new_tokens(0), 96)
        self.assertGreater(max_new_tokens(160_000), 96)
        self.assertEqual(max_new_tokens(16_000 * 10_000), 2048)


if __name__ == "__main__":
    unittest.main()
