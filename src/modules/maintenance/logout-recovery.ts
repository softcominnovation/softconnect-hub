import { MaintenanceLogoutError } from '../../adapters/evolution/evolution.maintenance';

export type DisconnectOutcome = 'confirm' | 'failed' | 'skipped_open';

export function isLogoutRecoveryTrigger(error: unknown, name: string) {
  if (!(error instanceof MaintenanceLogoutError)) return false;
  if (
    error.status === 400 &&
    error.messageText === `The "${name}" instance is not connected`
  )
    return true;
  return (
    error.status === 401 &&
    error.errorLabel === 'Unauthorized' &&
    error.messageText === 'Unauthorized'
  );
}

export async function dispatchDisconnect(input: {
  name: string;
  sawConnecting: boolean;
  expired: () => boolean;
  logout: () => Promise<unknown>;
  state: () => Promise<string>;
  connect: () => Promise<unknown>;
}): Promise<DisconnectOutcome> {
  try {
    await input.logout();
    return 'confirm';
  } catch (error) {
    if (!input.sawConnecting || !isLogoutRecoveryTrigger(error, input.name))
      throw error;
  }
  try {
    if (input.expired()) return 'failed';
    const before = await input.state();
    if (before === 'open') return 'skipped_open';
    if (before === 'close') return 'confirm';
    if (before !== 'connecting') return 'failed';
    if (input.expired()) return 'failed';
    await input.connect();
    if (input.expired()) return 'failed';
    const after = await input.state();
    if (after === 'open') return 'skipped_open';
    if (input.expired()) return 'failed';
    await input.logout();
    return 'confirm';
  } catch (error) {
    if (error instanceof Error && error.message === 'policy_or_lease_changed')
      throw error;
    return 'failed';
  }
}
