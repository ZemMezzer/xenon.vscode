import assert from "node:assert/strict";
import test from "node:test";
import { RestartScheduler } from "../../src/restartScheduler";

test("restart requests never run concurrently", async () => {
  let active = 0;
  let maximumActive = 0;
  const reasons: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const scheduler = new RestartScheduler(async (reason) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    reasons.push(reason);
    if (reasons.length === 1) {
      await firstGate;
    }
    active -= 1;
  });

  const first = scheduler.request("manual");
  const second = scheduler.request("configuration changed once");
  const third = scheduler.request("configuration changed twice");
  releaseFirst?.();
  await Promise.all([first, second, third]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(reasons, ["manual", "configuration changed twice"]);
});
