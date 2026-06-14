import { z } from 'zod';
import { selectorSchema } from './selector';

/** Built-in assertion set (spec FR-7). Discriminated on `assertion`. */

const elementVisibleSchema = z.object({
  assertion: z.literal('elementVisible'),
  selector: selectorSchema,
});

const elementNotVisibleSchema = z.object({
  assertion: z.literal('elementNotVisible'),
  selector: selectorSchema,
});

const textContainsSchema = z.object({
  assertion: z.literal('textContains'),
  selector: selectorSchema,
  value: z.string(),
  caseInsensitive: z.boolean().default(false),
});

const textEqualsSchema = z.object({
  assertion: z.literal('textEquals'),
  selector: selectorSchema,
  value: z.string(),
});

const inputValueSchema = z.object({
  assertion: z.literal('inputValue'),
  selector: selectorSchema,
  value: z.string(),
});

const urlMatchesSchema = z.object({
  assertion: z.literal('urlMatches'),
  pattern: z.string().min(1),
  patternType: z.enum(['glob', 'regex']).default('glob'),
});

const elementCountSchema = z.object({
  assertion: z.literal('elementCount'),
  selector: selectorSchema,
  count: z.number().int().nonnegative(),
  comparator: z.enum(['eq', 'gte', 'lte']).default('eq'),
});

const elementEnabledSchema = z.object({
  assertion: z.literal('elementEnabled'),
  selector: selectorSchema,
});

const elementDisabledSchema = z.object({
  assertion: z.literal('elementDisabled'),
  selector: selectorSchema,
});

export const assertionSchema = z.discriminatedUnion('assertion', [
  elementVisibleSchema,
  elementNotVisibleSchema,
  textContainsSchema,
  textEqualsSchema,
  inputValueSchema,
  urlMatchesSchema,
  elementCountSchema,
  elementEnabledSchema,
  elementDisabledSchema,
]);

export const assertionNames = [
  'elementVisible',
  'elementNotVisible',
  'textContains',
  'textEquals',
  'inputValue',
  'urlMatches',
  'elementCount',
  'elementEnabled',
  'elementDisabled',
] as const;

export type Assertion = z.infer<typeof assertionSchema>;
export type AssertionName = (typeof assertionNames)[number];
