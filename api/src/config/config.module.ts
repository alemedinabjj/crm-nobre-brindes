import { Global, Module } from '@nestjs/common';
import { Clock } from '../clock/clock.js';
import { APP_CONFIG, loadConfig } from './app-config.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }, Clock],
  exports: [APP_CONFIG, Clock],
})
export class ConfigModule {}
