import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfig>(APP_CONFIG);

  app.enableCors({
    origin: config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  });
  app.enableShutdownHooks();

  await app.listen(config.PORT);
  console.log(`API em http://localhost:${config.PORT}`);
};

await bootstrap();
