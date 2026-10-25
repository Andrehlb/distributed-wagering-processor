import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './interfaces/http/configure-app.js';
import { JsonLogger } from './infrastructure/observability/telemetry.js';
const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
configureApp(app);
await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
