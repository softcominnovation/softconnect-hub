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
  report?: (result: string, fields?: Record<string, string | number>) => void;
}): Promise<DisconnectOutcome> {
  const report = input.report ?? (() => undefined);
  const failure = (error: unknown) => {
    if (error instanceof Error && error.message === 'policy_or_lease_changed')
      throw error;
    const status = error instanceof MaintenanceLogoutError ? error.status : '';
    const code = error instanceof Error ? error.message : 'recovery_failed';
    report('recovery_failed', { code, status });
    return 'failed' as const;
  };
  try {
    report('logout_attempted');
    await input.logout();
    report('logout_accepted');
    return 'confirm';
  } catch (error) {
    if (!input.sawConnecting || !isLogoutRecoveryTrigger(error, input.name))
      throw error;
    report(
      'logout_refused',
      error instanceof MaintenanceLogoutError ? { status: error.status } : {},
    );
  }
  try {
    if (input.expired()) return failure(new Error('deadline'));
    const before = await input.state();
    if (before === 'open') {
      report('recovery_skipped', { reason: 'open', state: before });
      return 'skipped_open';
    }
    if (before !== 'connecting' && before !== 'close')
      return failure(new Error('state_invalid'));
    report('recovery_state', { state: before });
    if (input.expired()) return failure(new Error('deadline'));
    report('recovery_connect');
    await input.connect();
    report('recovery_connect_accepted');
    if (input.expired()) return failure(new Error('deadline'));
    const after = await input.state();
    if (after === 'open') {
      report('recovery_skipped', { reason: 'open', state: after });
      return 'skipped_open';
    }
    if (input.expired()) return failure(new Error('deadline'));
    report('recovery_logout');
    await input.logout();
    report('recovery_logout_accepted');
    return 'confirm';
  } catch (error) {
    return failure(error);
  }
}
