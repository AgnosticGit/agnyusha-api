import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';
import { createOriginGuard } from './common/origin.guard';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Keep `+` in query values (needed for OAuth authorization codes).
  app.set('query parser', 'simple');
  app.use(cookieParser());
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  app.setGlobalPrefix('api');

  const corsOrigins = config
    .get<string>('CORS_ORIGIN')
    ?.split(',')
    .map((o) => o.trim()) ?? ['http://localhost:3000'];
  app.use(createOriginGuard(corsOrigins));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.enableShutdownHooks();

  const port = config.get<number>('PORT') ?? 3001;
  await app.listen(port);
  console.log(
    `API listening on http://localhost:${port} [${config.get('NODE_ENV')}]`,
  );
}
void bootstrap();
