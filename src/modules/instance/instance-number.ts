/** Enrich query responses only; never change the provider's object or inventory. */
export function withInstanceNumber(
  instance: Record<string, unknown>,
  adapterType: string,
): Record<string, unknown> {
  if (adapterType !== 'evolution') return instance;

  const { number, ownerJid } = instance;
  const isEmpty =
    number == null || (typeof number === 'string' && number.trim() === '');
  if (!isEmpty || typeof ownerJid !== 'string') return instance;

  const match = /^([0-9]+)@s\.whatsapp\.net$/.exec(ownerJid);
  // `$` also matches before a final newline; require the entire JID to match.
  if (!match || match[0] !== ownerJid) return instance;

  return { ...instance, number: match[1] };
}
