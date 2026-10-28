export const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'PAYMENT-REQUIRED,PAYMENT-RESPONSE',
};

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', ...headers },
  });

export const errorResponse = (status: number, error: string, headers: Record<string, string> = {}): Response =>
  jsonResponse(status, { error }, headers);

export const publicUrl = (request: Request, baseUrl: string | undefined): string => {
  return publicUrlForPath(request, new URL(request.url).pathname, baseUrl);
};

export const publicUrlForPath = (request: Request, pathname: string, baseUrl: string | undefined): string => {
  const url = new URL(request.url);
  if (baseUrl) return `${baseUrl.replace(/\/+$/, '')}${pathname}`;
  const protocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(/:$/, '');
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || url.host;
  return `${protocol}://${host}${pathname}`;
};

// Edge latency and application latency are different problems: this header lets a
// client or an operator see which one they are paying for without docker exec.
export const withServerTiming = (response: Response, startedAt: number): Response => {
  const headers = new Headers(response.headers);
  headers.set('server-timing', `app;dur=${(performance.now() - startedAt).toFixed(1)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
