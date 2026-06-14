import { z } from 'zod';
import { assertionSchema } from './assertion';
import { stepSchema } from './step';

export const SCHEMA_VERSION = '1.0';

/**
 * Session marker (FR-10, decided): declared by a *setup* scenario; a cheap
 * assertion meaning "this session is still active". If it passes, a suite run
 * may skip re-running this setup. Absent marker = setup always re-runs.
 */
export const scenarioMetaSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** Base URL or {{ENV_VAR}} placeholder resolved from an environment profile. */
  baseUrl: z.string().optional(),
  tags: z.array(z.string()).default([]),
  sessionMarker: assertionSchema.optional(),
});

/**
 * Named data source. Credentials NEVER live here — `connectorRef` maps to a
 * connector profile in the local encrypted vault (FR-3, FR-9).
 */
export const dataSourceSchema = z.object({
  name: z.string().min(1),
  type: z.literal('database'),
  connectorRef: z.string().min(1),
});

/** One level of chaining in MVP: a setup scenario may not declare its own. */
export const setupRefSchema = z.object({
  scenarioRef: z.string().min(1),
});

export const scenarioSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  meta: scenarioMetaSchema,
  setup: setupRefSchema.optional(),
  dataSources: z.array(dataSourceSchema).default([]),
  steps: z.array(stepSchema).min(1),
});

export type ScenarioMeta = z.infer<typeof scenarioMetaSchema>;
export type DataSource = z.infer<typeof dataSourceSchema>;
export type SetupRef = z.infer<typeof setupRefSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
