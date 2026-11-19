import assert from 'node:assert/strict';
import test from 'node:test';
import { exportBrowserOptions, exportBrowserDiagnostics } from './export-browser.mjs';

test('compatibility changes only the Windows Skia backend and preserves rendering flags', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const defaults = exportBrowserOptions(platform);
    assert.deepEqual(exportBrowserOptions(platform, false), defaults);
    assert.equal(defaults.args.includes('--disable-skia-graphite'), false);
    const enabled = exportBrowserOptions(platform, true);
    assert.deepEqual(enabled.args.filter(arg => arg !== '--disable-skia-graphite'), defaults.args);
    assert.equal(enabled.args.includes('--disable-skia-graphite'), platform === 'win32');
    assert.equal(enabled.args.includes('--disable-gpu'), false);
    assert.equal(enabled.headless, true);
  }
});

test('renderer diagnostics distinguish a requested mode from platform application and observed backend', async () => {
  let detached = 0;
  const browser = {
    version: async () => 'Chrome/test',
    target: () => ({ createCDPSession: async () => ({
      send: async method => {
        assert.equal(method, 'SystemInfo.getInfo');
        return { gpu: { devices: [{ deviceId: 'private' }], auxAttributes: {
          skiaBackendType: 'GaneshGL', glRenderer: 'ANGLE/test', privatePath: '/private',
        }, featureStatus: { skia_graphite: 'disabled_off', gpu_compositing: 'enabled', rasterization: 'enabled' } } };
      },
      detach: async () => { detached++; },
    }) }),
  };
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const enabled of [false, true]) {
      const result = await exportBrowserDiagnostics(browser, enabled, platform);
      assert.equal(result.compatibilityMode, enabled);
      assert.equal(result.compatibilityApplied, enabled && platform === 'win32');
      assert.equal(result.skiaBackendType, 'GaneshGL');
      assert.equal(result.gpuCompositing, 'enabled');
      assert.equal(result.version, 'Chrome/test');
      assert.doesNotMatch(JSON.stringify(result), /private|deviceId/);
    }
  }
  assert.equal(detached, 6);
});

test('unsupported GPU diagnostics remain nonfatal and detach the session', async () => {
  let detached = false;
  const result = await exportBrowserDiagnostics({
    version: async () => 'Chrome/test',
    target: () => ({ createCDPSession: async () => ({
      send: async () => { throw new Error('unsupported protocol'); },
      detach: async () => { detached = true; },
    }) }),
  }, true, 'win32');
  assert.deepEqual(result, { compatibilityMode: true, compatibilityApplied: true, platform: 'win32', diagnosticUnavailable: true });
  assert.equal(detached, true);
});

test('unresponsive diagnostics have a bounded wait', async () => {
  const result = await exportBrowserDiagnostics({
    target: () => ({ createCDPSession: () => new Promise(() => {}) }),
  }, false, 'linux');
  assert.equal(result.diagnosticUnavailable, true);
});
