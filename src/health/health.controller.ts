import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../common/swagger/api-error-responses.decorator.js';
import { APP_VERSION } from '../app.constants.js';
import { HealthService } from './health.service.js';

@ApiTags('Operations')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness: the database is reachable' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        checks: { type: 'object', additionalProperties: true },
        version: { type: 'string' },
        uptime_s: { type: 'integer' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiErrorResponses('SERVICE_UNAVAILABLE')
  check() {
    return this.health.check(APP_VERSION);
  }
}
