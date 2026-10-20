export type NativeExecutionMode = 'restricted' | 'permissive';
export interface NativeExecutionChoice {
  mode: NativeExecutionMode;
  acknowledgement?: { userConsent: string; outsideAccessAllowed: true; automaticCommandsAllowed: true; noFilesystemIsolation: true };
}
// Pure validation: no account/database access and never writes provider metadata.
export function assertNativeExecutionPolicy(settings: any, choice: NativeExecutionChoice = { mode: 'restricted' }) {
  if (choice.mode === 'restricted') {
    if (settings?.fileAccessPolicy !== 'AGENT_SETTING_POLICY_DENY') throw new Error('NATIVE_WORKSPACE_OUTSIDE_ACCESS_NOT_DENIED');
    if (settings?.autoExecutionPolicy !== 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF') throw new Error('NATIVE_WORKSPACE_COMMAND_REVIEW_REQUIRED');
    return { mode: choice.mode, outsideAccessDenied: true, manualCommandReview: true, filesystemIsolation: false };
  }
  if (choice.mode !== 'permissive') throw new Error('NATIVE_EXECUTION_MODE_INVALID');
  const ack = choice.acknowledgement;
  if (!ack || typeof ack.userConsent !== 'string' || !ack.userConsent.trim() || ack.userConsent.length > 2000 ||
      ack.outsideAccessAllowed !== true || ack.automaticCommandsAllowed !== true || ack.noFilesystemIsolation !== true) {
    throw new Error('NATIVE_PERMISSIVE_EXPLICIT_ACKNOWLEDGEMENT_REQUIRED');
  }
  if (settings?.fileAccessPolicy !== 'AGENT_SETTING_POLICY_ALLOW' || settings?.autoExecutionPolicy !== 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER') {
    throw new Error('NATIVE_PERMISSIVE_OFFICIAL_POLICY_MISMATCH');
  }
  return { mode: choice.mode, outsideAccessDenied: false, manualCommandReview: false, filesystemIsolation: false };
}
