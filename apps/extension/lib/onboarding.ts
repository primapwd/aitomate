import type { Scenario } from '@aitomate/schema';

export interface OnboardingState {
  status: 'welcome' | 'import-scenario' | 'import-config' | 'complete';
}

export type OnboardingEvent =
  | { type: 'START' }
  | { type: 'SCENARIO_IMPORTED'; needsConfig: boolean }
  | { type: 'CONFIG_IMPORTED' }
  | { type: 'SKIP' };

export const initialOnboardingState: OnboardingState = { status: 'welcome' };

export function reduceOnboarding(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  if (state.status === 'complete') return state;

  switch (event.type) {
    case 'START':
      return state.status === 'welcome' ? { status: 'import-scenario' } : state;

    case 'SCENARIO_IMPORTED':
      return state.status === 'import-scenario'
        ? { status: event.needsConfig ? 'import-config' : 'complete' }
        : state;

    case 'CONFIG_IMPORTED':
      return state.status === 'import-config' ? { status: 'complete' } : state;

    case 'SKIP':
      return { status: 'complete' };

    default:
      return state;
  }
}

export function scenarioNeedsConfig(scenario: Scenario): boolean {
  if (scenario.dataSources && scenario.dataSources.length > 0) return true;

  for (const step of scenario.steps) {
    if (step.action === 'fill') {
      const resolver = step.resolver;
      if (resolver.type === 'dynamic' && resolver.mode === 'ai') return true;
      if (resolver.type === 'database') return true;
    }
  }

  return false;
}
