import type { McApi } from '../electron/preload';
import type { McSetupApi } from '../electron/setupPreload';

declare global {
  interface Window {
    mc: McApi;
    /** setup window only (src/setup.html + electron/setupPreload.ts) */
    mcSetup: McSetupApi;
    /** E2E hook: main calls this (with user gesture) when MC_AUTOSTART=1 */
    __mcAutoStart?: () => void;
    /** visual-QA hooks: main calls these when MC_MAIN_SHOT=<dir> */
    __mcOpenSettings?: () => void;
    __mcOpenHelp?: () => void;
  }
}

export {};
