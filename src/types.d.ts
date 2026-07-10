import type { McApi } from '../electron/preload';

declare global {
  interface Window {
    mc: McApi;
    /** E2E hook: main calls this (with user gesture) when MC_AUTOSTART=1 */
    __mcAutoStart?: () => void;
  }
}

export {};
