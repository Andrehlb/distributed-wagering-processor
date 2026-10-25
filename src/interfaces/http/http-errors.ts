import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  observability,
  requestContext,
} from '../../infrastructure/observability/telemetry.js';
const invalid = new Set([
  'INVALID_WAGER_INPUT',
  'INVALID_WALLET_INPUT',
  'INVALID_MONEY_AMOUNT',
  'INVALID_CURRENCY',
  'INVALID_TRANSACTION_AMOUNT',
  'UNSUPPORTED_TRANSACTION_KIND',
  'WALLET_PLAYER_MISMATCH',
  'CURRENCY_MISMATCH',
  'REFERENCE_REQUIRED',
  'REFERENCE_NOT_APPLICABLE',
  'INVALID_REFERENCE',
  'INVALID_CURSOR',
  'INVALID_PAGINATION',
  'UNSUPPORTED_CURRENCY',
  'AMOUNT_OUT_OF_RANGE',
]);
export function classifyError(error: unknown): {
  status: number;
  code: string;
} {
  const code = error instanceof Error ? error.message : '';
  if ((error as { type?: string })?.type === 'entity.parse.failed')
    return { status: 400, code: 'INVALID_JSON' };
  if ((error as { type?: string })?.type === 'entity.too.large')
    return { status: 413, code: 'PAYLOAD_TOO_LARGE' };
  if (invalid.has(code)) return { status: 400, code };
  if (
    [
      'IDEMPOTENCY_CONFLICT',
      'INBOX_PAYLOAD_CONFLICT',
      'WALLET_ALREADY_EXISTS',
    ].includes(code)
  )
    return { status: 409, code };
  if (['WALLET_NOT_FOUND', 'TRANSACTION_NOT_FOUND'].includes(code))
    return { status: 404, code };
  const state = (error as { code?: string })?.code;
  if (['40P01', '40001', '55P03'].includes(state ?? ''))
    observability.increment('lock_conflicts_total');
  if (
    state ||
    ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].some((v) => code.includes(v))
  )
    return { status: 503, code: 'INFRASTRUCTURE_UNAVAILABLE' };
  return { status: 500, code: 'INTERNAL_ERROR' };
}
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      response.status(status).json({
        statusCode: status,
        code:
          status === 400
            ? 'INVALID_INPUT'
            : status === 404
              ? 'RESOURCE_NOT_FOUND'
              : status === 503
                ? 'INFRASTRUCTURE_UNAVAILABLE'
                : 'HTTP_ERROR',
        ...(typeof body === 'object' ? body : {}),
        correlationId: requestContext.getStore()?.correlationId,
      });
      return;
    }
    const mapped = classifyError(error);
    observability.log(mapped.status >= 500 ? 'error' : 'warn', 'http_failure', {
      code: mapped.code,
    });
    if (mapped.status === 503) response.setHeader('Retry-After', '1');
    response.status(mapped.status).json({
      statusCode: mapped.status,
      code: mapped.code,
      correlationId: requestContext.getStore()?.correlationId,
    });
  }
}
