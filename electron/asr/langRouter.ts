/**
 * Language routing for zh/en code-switching meetings (pure logic, TDD).
 *
 * transformers.js 3.8.1 has no whisper language auto-detection (unset
 * language FORCES English and mistranslates Chinese). We run our own LID —
 * one decoder step, argmax over the <|zh|>/<|en|> language-token logits —
 * and this router turns raw LID results into a stable per-segment decision:
 * short segments and low-confidence detections stick to the last language.
 */

export type MeetingLang = 'chinese' | 'english';

export interface LidResult {
  lang: MeetingLang;
  /** |logit(zh) - logit(en)| — confidence gap */
  margin: number;
}

export interface LanguageRouterOptions {
  initial: MeetingLang;
  /** segments shorter than this reuse the last language (LID unreliable) */
  minAudioMsForLid: number;
  /** LID margins below this are treated as "unsure" -> sticky */
  minMargin: number;
}

export const DEFAULT_ROUTER_OPTIONS: LanguageRouterOptions = {
  initial: 'chinese',
  minAudioMsForLid: 1200,
  minMargin: 1.0,
};

export class LanguageRouter {
  private readonly opts: LanguageRouterOptions;
  private lastLang: MeetingLang;

  constructor(opts: Partial<LanguageRouterOptions> = {}) {
    this.opts = { ...DEFAULT_ROUTER_OPTIONS, ...opts };
    this.lastLang = this.opts.initial;
  }

  /** last decided language (for partials, which skip LID) */
  get currentLang(): MeetingLang {
    return this.lastLang;
  }

  shouldRunLid(audioMs: number): boolean {
    return audioMs >= this.opts.minAudioMsForLid;
  }

  decide(audioMs: number, lid: LidResult | null): MeetingLang {
    if (lid && audioMs >= this.opts.minAudioMsForLid && lid.margin >= this.opts.minMargin) {
      this.lastLang = lid.lang;
    }
    return this.lastLang;
  }
}
