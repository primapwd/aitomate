import { z } from 'zod';

/** Fixed value known at authoring time. Zero configuration to run. */
export const staticResolverSchema = z.object({
  type: z.literal('static'),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

/** Pick from a candidate list, randomly or sequentially. Zero configuration. */
export const dynamicArrayResolverSchema = z.object({
  type: z.literal('dynamic'),
  mode: z.literal('array'),
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
  order: z.enum(['random', 'sequential']).default('random'),
});

/** LLM-generated value. Requires a configured provider (FR-9 config). */
export const dynamicAiResolverSchema = z.object({
  type: z.literal('dynamic'),
  mode: z.literal('ai'),
  prompt: z.string().min(1),
  constraints: z
    .object({
      format: z.string().optional(),
      maxLength: z.number().int().positive().optional(),
      regex: z.string().optional(),
    })
    .optional(),
  provider: z.string().default('configured-default'),
});

/**
 * Live database value via the local Aitomate Bridge. `dataSourceRef` must match
 * a `dataSources[].name` entry in the scenario; credentials never appear here.
 */
export const databaseResolverSchema = z.object({
  type: z.literal('database'),
  dataSourceRef: z.string().min(1),
  query: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

/** Placeholder resolved from a declarative-plugin action parameter (FR-4). */
export const paramResolverSchema = z.object({
  type: z.literal('param'),
  name: z.string().min(1),
});

export const dynamicResolverSchema = z.discriminatedUnion('mode', [
  dynamicArrayResolverSchema,
  dynamicAiResolverSchema,
]);

export const resolverSchema = z.discriminatedUnion('type', [
  staticResolverSchema,
  dynamicResolverSchema,
  databaseResolverSchema,
  paramResolverSchema,
]);

export type StaticResolver = z.infer<typeof staticResolverSchema>;
export type DynamicArrayResolver = z.infer<typeof dynamicArrayResolverSchema>;
export type DynamicAiResolver = z.infer<typeof dynamicAiResolverSchema>;
export type DatabaseResolver = z.infer<typeof databaseResolverSchema>;
export type ParamResolver = z.infer<typeof paramResolverSchema>;
export type Resolver = z.infer<typeof resolverSchema>;
