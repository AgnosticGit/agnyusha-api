import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.use(cookieParser());
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableCors({
    origin: config.get<string>('CORS_ORIGIN')?.split(',') ?? [
      'http://localhost:3000',
    ],
    credentials: true,
  });

  const port = config.get<number>('PORT') ?? 3001;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port} [${config.get('NODE_ENV')}]`);
}
bootstrap();
