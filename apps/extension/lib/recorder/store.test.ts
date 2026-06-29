import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  clearRecording,
  getRecording,
  resetRecordingCache,
  saveRecording,
} from './store';

beforeEach(() => {
  fakeBrowser.reset();
  resetRecordingCache();
});

describe('recorder store', () => {
  it('returns an idle, empty recording for an unknown tab', async () => {
    const recording = await getRecording(42);
    expect(recording).toEqual({ session: { status: 'idle' }, steps: [] });
  });

  it('persists a recording across a service-worker restart (cache wiped)', async () => {
    const recording = await getRecording(7);
    recording.session = { status: 'recording', originUrl: 'https://app.test' };
    recording.steps.push({ id: 'step-1', action: 'navigate', url: 'https://app.test/cart' });
    await saveRecording(7, recording);

    resetRecordingCache(); // simulate MV3 worker teardown

    const revived = await getRecording(7);
    expect(revived.session).toEqual({ status: 'recording', originUrl: 'https://app.test' });
    expect(revived.steps).toHaveLength(1);
  });

  it('isolates recordings per tab', async () => {
    const a = await getRecording(1);
    a.session = { status: 'recording', originUrl: 'https://a.test' };
    await saveRecording(1, a);

    const b = await getRecording(2);
    expect(b.session.status).toBe('idle');
  });

  it('clears a recording when its tab closes', async () => {
    const recording = await getRecording(9);
    recording.session = { status: 'recording', originUrl: 'https://app.test' };
    await saveRecording(9, recording);

    await clearRecording(9);
    resetRecordingCache();

    const afterClose = await getRecording(9);
    expect(afterClose.session.status).toBe('idle');
    expect(afterClose.steps).toHaveLength(0);
  });

  it('shares one in-flight load between concurrent readers of the same tab', async () => {
    const [first, second] = await Promise.all([getRecording(3), getRecording(3)]);
    expect(first).toBe(second);
  });
});
