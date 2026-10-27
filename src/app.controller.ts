import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { APP_NAME, APP_VERSION } from './app.constants.js';

@Controller({ path: '', version: VERSION_NEUTRAL })
export class AppController {
  @Get()
  @ApiExcludeEndpoint()
  index() {
    return {
      name: APP_NAME,
      version: APP_VERSION,
      docs: '/docs',
      openapi: '/docs-json',
      health: '/health',
    };
  }
}
