import { z } from 'zod';
import { scenarioSchema, type Scenario } from './scenario';

/** Raised for any invalid scenario input; message is safe to show in the UI. */
export class ScenarioParseError extends Error {
  constructor(
    message: string,
    public readonly issues: z.core.$ZodIssue[] = [],
  ) {
    super(message);
    this.name = 'ScenarioParseError';
  }
}

/**
 * Parse an `.aitomate.json` document (object or JSON string) into a validated
 * Scenario. Throws ScenarioParseError with a plain-language message (Constitution:
 * "fail loud, fail clear").
 */
export function parseScenario(input: unknown): Scenario {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new ScenarioParseError(
        'This file is not valid JSON. It may be corrupted or not an Aitomate scenario file.',
      );
    }
  }

  const result = scenarioSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ScenarioParseError(
      `This scenario file is not valid: ${details}`,
      result.error.issues,
    );
  }
  return result.data;
}

/** Non-throwing variant. */
export function safeParseScenario(input: unknown):
  | { success: true; scenario: Scenario }
  | { success: false; error: ScenarioParseError } {
  try {
    return { success: true, scenario: parseScenario(input) };
  } catch (error) {
    if (error instanceof ScenarioParseError) {
      return { success: false, error };
    }
    throw error;
  }
}
