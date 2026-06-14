import { z } from 'zod';
import { selectorSchema } from './selector';
import { resolverSchema } from './resolver';
import { assertionSchema } from './assertion';

/** Per-step reliability tuning (NFR Reliability). All optional. */
export const stepOptionsSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  retry: z
    .object({
      count: z.number().int().nonnegative(),
      backoffMs: z.number().int().nonnegative().default(500),
    })
    .optional(),
});

const stepBase = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  options: stepOptionsSchema.optional(),
});

export const navigateStepSchema = stepBase.extend({
  action: z.literal('navigate'),
  /** Absolute URL or path resolved against meta.baseUrl / {{BASE_URL}}. */
  url: z.string().min(1),
});

export const clickStepSchema = stepBase.extend({
  action: z.literal('click'),
  selector: selectorSchema,
});

export const fillStepSchema = stepBase.extend({
  action: z.literal('fill'),
  selector: selectorSchema,
  resolver: resolverSchema,
});

export const keypressStepSchema = stepBase.extend({
  action: z.literal('keypress'),
  selector: selectorSchema.optional(),
  key: z.enum(['Enter', 'Tab', 'Escape']),
});

export const waitStepSchema = stepBase.extend({
  action: z.literal('wait'),
  /** Explicit wait. Either a fixed duration or an element to wait for. */
  durationMs: z.number().int().positive().optional(),
  forSelector: selectorSchema.optional(),
});

/** File upload replay via DataTransfer; fixture is bundled/imported (FR-6). */
export const uploadStepSchema = stepBase.extend({
  action: z.literal('upload'),
  selector: selectorSchema,
  fixtureRef: z.string().min(1),
});

export const assertStepSchema = stepBase
  .extend({ action: z.literal('assert') })
  .and(assertionSchema);

export const stepSchema = z.union([
  navigateStepSchema,
  clickStepSchema,
  fillStepSchema,
  keypressStepSchema,
  waitStepSchema,
  uploadStepSchema,
  assertStepSchema,
]);

export type StepOptions = z.infer<typeof stepOptionsSchema>;
export type NavigateStep = z.infer<typeof navigateStepSchema>;
export type ClickStep = z.infer<typeof clickStepSchema>;
export type FillStep = z.infer<typeof fillStepSchema>;
export type KeypressStep = z.infer<typeof keypressStepSchema>;
export type WaitStep = z.infer<typeof waitStepSchema>;
export type UploadStep = z.infer<typeof uploadStepSchema>;
export type AssertStep = z.infer<typeof assertStepSchema>;
export type Step = z.infer<typeof stepSchema>;
