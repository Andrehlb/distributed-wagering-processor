import { afterEach, beforeEach, describe, it } from 'bun:test';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';

(process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip)(
  'AppController (e2e)',
  () => {
    let app: INestApplication<App>;

    beforeEach(async () => {
      const { AppModule } = await import('../src/app.module.js');
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    it('/ (GET)', async () => {
      await request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect('Hello World!');
    });

    afterEach(async () => {
      await app.close();
    });
  },
);
