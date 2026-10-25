import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../../infrastructure/observability/telemetry.js';
import { HttpErrorFilter } from './http-errors.js';
export function configureApp(app: INestApplication) {
  app.useGlobalFilters(new HttpErrorFilter());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const supplied = req.header('x-correlation-id');
    const correlationId =
      supplied && /^[\w.:/-]{1,150}$/.test(supplied) ? supplied : randomUUID();
    res.setHeader('x-correlation-id', correlationId);
    requestContext.run({ correlationId }, next);
  });
  app.enableShutdownHooks();
}
