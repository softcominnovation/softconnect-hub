import { decryptAES256GCM, encryptAES256GCM } from '../../common/crypto.util';
import type {
  CreateInstanceDto,
  InstanceDefaultWebhookConfig,
} from '../../providers/whatsapp-provider.interface';

export interface ProvisioningPayload {
  token: string;
  clientToken?: string;
  request: CreateInstanceDto;
  webhook?: InstanceDefaultWebhookConfig;
  webhookApplied: boolean;
}

export function encodePayload(payload: ProvisioningPayload, key: string) {
  return encryptAES256GCM(JSON.stringify(payload), key);
}

export function decodePayload(value: string | null, key: string) {
  if (!value) throw new Error('Missing provisioning evidence');
  const payload = JSON.parse(
    decryptAES256GCM(value, key),
  ) as ProvisioningPayload;
  if (!payload.token || !payload.request?.instanceName)
    throw new Error('Invalid provisioning evidence');
  return payload;
}
