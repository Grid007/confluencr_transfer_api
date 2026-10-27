import { z } from 'zod';

/** Converts a Zod schema to an OpenAPI 3.0 schema object for use in @ApiResponse decorators. */
export function openApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'output') {
  const json = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
