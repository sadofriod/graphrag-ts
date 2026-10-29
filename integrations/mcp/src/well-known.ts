const jsonResponse = (request: Request, status: number, body: unknown): Response => new Response(
  request.method === 'HEAD' ? null : JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=300',
  },
});

export const requestOrigin = (request: Request, publicBaseUrl?: string): string => {
  if (publicBaseUrl) return new URL(publicBaseUrl).origin;

  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || url.host;
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
  const scheme = forwardedProto || (localHost ? 'http' : 'https');
  return `${scheme}://${host}`;
};

export const wellKnownResponse = (
  request: Request,
  options?: { publicBaseUrl?: string },
): Response | undefined => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/.well-known/')) return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const response = jsonResponse(request, 405, { error: 'Method not allowed.' });
    response.headers.set('allow', 'GET, HEAD');
    return response;
  }

  const origin = requestOrigin(request, options?.publicBaseUrl);
  if (url.pathname === '/.well-known/oauth-protected-resource'
    || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
    const resource = url.pathname.endsWith('/mcp') ? `${origin}/mcp` : origin;
    return jsonResponse(request, 200, {
      resource,
      bearer_methods_supported: ['header'],
      resource_name: 'graphrag-ts',
      resource_documentation: 'https://github.com/sadofriod/graphrag-ts',
    });
  }

  return jsonResponse(request, 404, { error: 'Not found.' });
};
