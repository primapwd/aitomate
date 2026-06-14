import { readFileSync } from 'node:fs';
import {
  parseScenario,
  safeParseScenario,
  ScenarioParseError,
  scenarioSchema,
  resolverSchema,
  assertionSchema,
  stepSchema,
} from '../src';

const specExample = readFileSync(
  new URL('./fixtures/checkout-flow.aitomate.json', import.meta.url),
  'utf-8',
);

describe('scenario schema', () => {
  it('parses the spec §3.3 example (string input)', () => {
    const scenario = parseScenario(specExample);
    expect(scenario.meta.name).toBe('Checkout Flow - Guest User');
    expect(scenario.setup?.scenarioRef).toBe('login-as-student');
    expect(scenario.steps).toHaveLength(7);
  });

  it('parses object input', () => {
    const scenario = parseScenario(JSON.parse(specExample));
    expect(scenario.dataSources[0]?.connectorRef).toBe('mysql-primary');
  });

  it('applies defaults (tags, dataSources, dynamic order)', () => {
    const scenario = parseScenario({
      schemaVersion: '1.0',
      meta: { name: 'minimal' },
      steps: [
        {
          id: 's1',
          action: 'fill',
          selector: { strategy: 'id', value: 'email' },
          resolver: { type: 'dynamic', mode: 'array', values: ['a'] },
        },
      ],
    });
    expect(scenario.meta.tags).toEqual([]);
    expect(scenario.dataSources).toEqual([]);
    const step = scenario.steps[0];
    if (step?.action !== 'fill') throw new Error('expected fill step');
    expect(step.resolver).toMatchObject({ order: 'random' });
  });

  it('accepts a setup scenario with a sessionMarker (FR-10)', () => {
    const scenario = parseScenario({
      schemaVersion: '1.0',
      meta: {
        name: 'login-as-student',
        sessionMarker: {
          assertion: 'elementVisible',
          selector: { strategy: 'testid', value: 'user-menu' },
        },
      },
      steps: [{ id: 's1', action: 'navigate', url: '/login' }],
    });
    expect(scenario.meta.sessionMarker?.assertion).toBe('elementVisible');
  });

  it('rejects unknown schemaVersion', () => {
    expect(() =>
      parseScenario({
        schemaVersion: '2.0',
        meta: { name: 'x' },
        steps: [{ id: 's1', action: 'navigate', url: '/' }],
      }),
    ).toThrow(ScenarioParseError);
  });

  it('rejects empty steps', () => {
    const result = safeParseScenario({
      schemaVersion: '1.0',
      meta: { name: 'x' },
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid JSON string with a plain-language message', () => {
    const result = safeParseScenario('{not json');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('not valid JSON');
    }
  });

  it('rejects secrets-shaped dataSources (no inline credentials field)', () => {
    const result = scenarioSchema.safeParse({
      schemaVersion: '1.0',
      meta: { name: 'x' },
      dataSources: [{ name: 'db', type: 'database' }], // missing connectorRef
      steps: [{ id: 's1', action: 'navigate', url: '/' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('resolver schema', () => {
  it.each([
    [{ type: 'static', value: 'john@example.com' }],
    [{ type: 'static', value: 42 }],
    [{ type: 'static', value: true }],
    [{ type: 'dynamic', mode: 'array', values: ['a', 'b'], order: 'sequential' }],
    [
      {
        type: 'dynamic',
        mode: 'ai',
        prompt: 'realistic email',
        constraints: { format: 'email', maxLength: 40 },
      },
    ],
    [
      {
        type: 'database',
        dataSourceRef: 'app_users',
        query: 'SELECT email FROM users LIMIT 1',
      },
    ],
    [{ type: 'param', name: 'email' }],
  ])('accepts %j', (resolver) => {
    expect(resolverSchema.safeParse(resolver).success).toBe(true);
  });

  it.each([
    [{ type: 'dynamic', mode: 'array', values: [] }],
    [{ type: 'dynamic', mode: 'ai' }],
    [{ type: 'database', query: 'SELECT 1' }],
    [{ type: 'unknown' }],
  ])('rejects %j', (resolver) => {
    expect(resolverSchema.safeParse(resolver).success).toBe(false);
  });
});

describe('assertion schema', () => {
  const sel = { strategy: 'css', value: '#el' };

  it.each([
    [{ assertion: 'elementVisible', selector: sel }],
    [{ assertion: 'elementNotVisible', selector: sel }],
    [{ assertion: 'textContains', selector: sel, value: 'Hello' }],
    [{ assertion: 'textEquals', selector: sel, value: 'Hello' }],
    [{ assertion: 'inputValue', selector: sel, value: 'x' }],
    [{ assertion: 'urlMatches', pattern: '**/done' }],
    [{ assertion: 'urlMatches', pattern: '/done$/', patternType: 'regex' }],
    [{ assertion: 'elementCount', selector: sel, count: 3, comparator: 'gte' }],
    [{ assertion: 'elementEnabled', selector: sel }],
    [{ assertion: 'elementDisabled', selector: sel }],
  ])('accepts %j', (assertion) => {
    expect(assertionSchema.safeParse(assertion).success).toBe(true);
  });

  it.each([
    [{ assertion: 'textContains', selector: sel }], // missing value
    [{ assertion: 'elementCount', selector: sel }], // missing count
    [{ assertion: 'urlMatches' }], // missing pattern
    [{ assertion: 'nope', selector: sel }],
  ])('rejects %j', (assertion) => {
    expect(assertionSchema.safeParse(assertion).success).toBe(false);
  });
});

describe('step schema', () => {
  it('accepts shadow-piercing and frame-descending selectors', () => {
    const result = stepSchema.safeParse({
      id: 's1',
      action: 'click',
      selector: {
        strategy: 'css',
        value: 'button.submit',
        shadowPath: ['checkout-widget'],
        framePath: ['iframe#payment'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts upload step with fixtureRef', () => {
    const result = stepSchema.safeParse({
      id: 's1',
      action: 'upload',
      selector: { strategy: 'id', value: 'avatar' },
      fixtureRef: 'fixtures/avatar.png',
    });
    expect(result.success).toBe(true);
  });

  it('accepts per-step retry options', () => {
    const result = stepSchema.safeParse({
      id: 's1',
      action: 'click',
      selector: { strategy: 'text', value: 'Save' },
      options: { timeoutMs: 5000, retry: { count: 2, backoffMs: 250 } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects fill step without resolver', () => {
    const result = stepSchema.safeParse({
      id: 's1',
      action: 'fill',
      selector: { strategy: 'id', value: 'email' },
    });
    expect(result.success).toBe(false);
  });
});
