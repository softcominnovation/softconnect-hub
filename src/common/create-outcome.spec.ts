import { readEvidence, rejectedBeforeCreate } from './create-outcome';

describe('Create outcome evidence', () => {
  const native = {
    status: 400,
    error: 'Bad Request',
    response: { message: ['Invalid integration'] },
  };
  it('recognizes only the native pre-creation rejection', () => {
    expect(rejectedBeforeCreate(400, native)).toBe(true);
    for (const [status, body] of [
      [500, native],
      [400, { message: 'Invalid integration' }],
      [400, { ...native, instance: { id: 'created' } }],
      [
        400,
        {
          ...native,
          response: { message: ['Invalid integration', 'other failure'] },
        },
      ],
      [409, native],
    ])
      expect(rejectedBeforeCreate(status as number, body)).toBe(false);
  });
  it('does not infer outcomes from old or invalid evidence and strips unknown fields', () => {
    expect(readEvidence(null)).toEqual({ version: 1 });
    expect(
      readEvidence({ version: 1, create: { result: 'rejected' } }),
    ).toEqual({ version: 1 });
    expect(readEvidence({ version: 1, password: 'secret' })).toEqual({
      version: 1,
    });
  });
});
