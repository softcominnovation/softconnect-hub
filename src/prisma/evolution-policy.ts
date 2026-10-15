import { z } from 'zod';

export const maxInstancesSchema = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647)
  .nullable()
  .optional();
