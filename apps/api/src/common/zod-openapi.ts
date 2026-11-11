import { applyDecorators } from "@nestjs/common";
import { ApiQuery, type SchemaObject } from "@nestjs/swagger";
import { z } from "zod";

interface QueryParameter {
  name: string;
  required: boolean;
  schema: SchemaObject;
}

export function buildQueryParameters(schema: z.ZodType): QueryParameter[] {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
  }) as {
    properties?: Record<string, SchemaObject>;
    required?: string[];
  };
  const required = new Set(jsonSchema.required ?? []);
  return Object.entries(jsonSchema.properties ?? {}).map(([name, propertySchema]) => ({
    name,
    required: required.has(name),
    schema: propertySchema,
  }));
}

export function ApiQuerySchema(schema: z.ZodType): MethodDecorator {
  return applyDecorators(
    ...buildQueryParameters(schema).map((parameter) =>
      ApiQuery({
        name: parameter.name,
        required: parameter.required,
        schema: parameter.schema,
      }),
    ),
  );
}
