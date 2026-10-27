import { type ArgumentMetadata, Injectable, StandardSchemaValidationPipe } from '@nestjs/common';
import { z } from 'zod';
import { RequestValidationError } from '../errors/app.exception.js';

/**
 * Nest 12's native Standard Schema pipe, with one change: Zod schemas are parsed directly with
 * `reportInput`, so each issue carries the offending input. That is what lets us tell a missing
 * field (REQUIRED) from a wrongly typed one (INVALID_TYPE). Non-Zod schemas fall back to the base pipe.
 */
@Injectable()
export class ZodValidationPipe extends StandardSchemaValidationPipe {
  override async transform<T = unknown>(value: T, metadata: ArgumentMetadata): Promise<T> {
    const schema = metadata.schema;
    if (!schema || !this.toValidate(metadata)) return value;

    if (schema instanceof z.ZodType) {
      const result = await schema.safeParseAsync(value, { reportInput: true });
      if (!result.success) throw new RequestValidationError(result.error.issues, metadata.type);
      return result.data as T;
    }
    return super.transform(value, metadata);
  }
}
