import { z } from 'zod';

/**
 * Selector strategies, in recorder fallback priority order:
 * testid > id > aria > css > text.
 */
export const selectorStrategySchema = z.enum([
  'testid',
  'id',
  'aria',
  'css',
  'text',
]);

/**
 * A target element reference.
 *
 * - `shadowPath`: ordered list of shadow-host CSS selectors to pierce (open
 *   shadow roots only) before applying `strategy`/`value` in the innermost root.
 * - `framePath`: ordered list of same-origin iframe CSS selectors to descend
 *   into before resolving the element.
 */
export const selectorSchema = z.object({
  strategy: selectorStrategySchema,
  value: z.string().min(1),
  shadowPath: z.array(z.string().min(1)).optional(),
  framePath: z.array(z.string().min(1)).optional(),
});

export type SelectorStrategy = z.infer<typeof selectorStrategySchema>;
export type Selector = z.infer<typeof selectorSchema>;
