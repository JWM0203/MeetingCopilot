/** This controls only MeetingCopilot's own toast, never OS capture/detection policy. */
export function shouldNotifyWindowHidden(state: {
  trayExists: boolean;
  alreadyShown: boolean;
  actualProtection: boolean | null;
  protectionRequested: boolean;
}): boolean {
  // Unknown/failing protection is not a reason to expose an extra app-presence toast.
  return state.trayExists && !state.alreadyShown &&
    state.actualProtection === false && !state.protectionRequested;
}
