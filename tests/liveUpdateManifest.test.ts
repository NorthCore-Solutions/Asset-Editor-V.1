import { describe, expect, it } from 'vitest';
import { parseLiveUpdateManifest } from '../src/platform/liveUpdate';

const validManifest = {
  schemaVersion: 1,
  bundleId: '2-2026.08.05.1',
  downloadUrl: 'https://northcore-eu.de/updates/asset-editor/beta/bundles/2-2026.08.05.1.zip',
  checksum: 'a'.repeat(64),
  signature: 'c2lnbmF0dXJl',
  minimumNativeVersionCode: 2,
  maximumNativeVersionCode: 2
};

describe('Live-Update-Manifest', () => {
  it('akzeptiert ein signiertes HTTPS-Bundle für die passende native Version', () => {
    expect(parseLiveUpdateManifest(validManifest)).toEqual(validManifest);
  });

  it('verwirft unverschlüsselte Bundle-URLs', () => {
    expect(() => parseLiveUpdateManifest({
      ...validManifest,
      downloadUrl: 'http://example.com/update.zip'
    })).toThrow('HTTPS');
  });

  it('verwirft ungültige Prüfsummen und Versionsbereiche', () => {
    expect(() => parseLiveUpdateManifest({ ...validManifest, checksum: 'abc' })).toThrow('Prüfsumme');
    expect(() => parseLiveUpdateManifest({
      ...validManifest,
      minimumNativeVersionCode: 3,
      maximumNativeVersionCode: 2
    })).toThrow('maximale native Version');
  });
});
