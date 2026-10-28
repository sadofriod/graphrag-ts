const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};

const resolveUrl = (args: readonly string[]): string => {
  const explicit = optionValue(args, '--url');
  if (explicit) return explicit;
  const base = process.env.X402_PUBLIC_BASE_URL;
  if (!base) throw new Error('Pass --url or set X402_PUBLIC_BASE_URL.');
  return `${base.replace(/\/+$/, '')}/api/v1/query`;
};

const responseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try { return JSON.parse(text) as unknown; } catch { return { body: text }; }
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const paidUrl = resolveUrl(args);
  const facilitator = (optionValue(args, '--facilitator') ?? process.env.X402_FACILITATOR_URL ?? 'https://facilitator.payai.network').replace(/\/+$/, '');
  const listingUrl = `${facilitator}/discovery/listing-status?url=${encodeURIComponent(paidUrl)}`;
  try {
    const response = await fetch(listingUrl);
    const body = await responseBody(response);
    console.log(JSON.stringify({ status: response.status, body }, null, 2));
    if (response.status === 404) console.log('Hint: this facilitator may not provide the listing-status endpoint.');
    else if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Listing status request failed.');
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Listing status check failed.');
  process.exitCode = 1;
});
