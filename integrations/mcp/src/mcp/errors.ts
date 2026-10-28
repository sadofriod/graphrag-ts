import { AccessError } from '../access.ts';
import { InputError } from '../input.ts';
import type { Logger } from '../log.ts';

export class ToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export const toolErrorResult = (code: string, message: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
  isError: true,
});

export const paymentRequiredResult = (product: {
  readonly product: 'retraction-propagation' | 'retraction-evidence-audit';
  readonly usd: '$0.02' | '$0.10';
  readonly atomic: '20000' | '100000';
  readonly payEndpoint: string;
  readonly docsUrl: string;
}) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({
    error: 'payment_required',
    product: product.product,
    price: { usd: product.usd, atomic: product.atomic },
    scheme: 'x402',
    network: 'base',
    pay_endpoint: product.payEndpoint,
    docs: product.docsUrl,
  }) }],
  isError: true,
});

export const inputFailure = (error: unknown, logger: Logger, tool: string) => {
  if (error instanceof InputError || error instanceof AccessError) {
    return toolErrorResult(error.code, error.message);
  }
  logger.error('MCP tool failed.', {
    tool,
    error_name: error instanceof Error ? error.name : 'UnknownError',
  });
  return toolErrorResult('INTERNAL_ERROR', 'The operation failed. Check the server logs for details.');
};
