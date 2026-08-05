import { Capacitor } from '@capacitor/core';
import { LiveUpdate } from '@capawesome/capacitor-live-update';

const LIVE_UPDATE_MANIFEST_URL = 'https://updates.northcore-eu.de/asset-editor/beta/manifest.json';
const MANIFEST_TIMEOUT_MS = 10_000;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export interface LiveUpdateManifest {
  schemaVersion: 1;
  bundleId: string;
  downloadUrl: string;
  checksum: string;
  signature: string;
  minimumNativeVersionCode: number;
  maximumNativeVersionCode: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

export function parseLiveUpdateManifest(value: unknown): LiveUpdateManifest {
  if (!isRecord(value)) throw new Error('Live-Update-Manifest ist kein Objekt.');

  const manifest = value as Partial<LiveUpdateManifest>;
  if (manifest.schemaVersion !== 1) throw new Error('Unbekannte Manifest-Version.');
  if (typeof manifest.bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(manifest.bundleId) || manifest.bundleId === 'public') {
    throw new Error('Ungültige Bundle-ID.');
  }
  if (typeof manifest.downloadUrl !== 'string' || !isHttpsUrl(manifest.downloadUrl)) {
    throw new Error('Bundle-URL muss HTTPS verwenden.');
  }
  if (typeof manifest.checksum !== 'string' || !CHECKSUM_PATTERN.test(manifest.checksum)) {
    throw new Error('Ungültige SHA-256-Prüfsumme.');
  }
  if (typeof manifest.signature !== 'string' || !BASE64_PATTERN.test(manifest.signature)) {
    throw new Error('Ungültige Bundle-Signatur.');
  }
  if (!Number.isInteger(manifest.minimumNativeVersionCode) || (manifest.minimumNativeVersionCode ?? 0) < 1) {
    throw new Error('Ungültige minimale native Version.');
  }
  if (!Number.isInteger(manifest.maximumNativeVersionCode)
    || (manifest.maximumNativeVersionCode ?? 0) < (manifest.minimumNativeVersionCode ?? 0)) {
    throw new Error('Ungültige maximale native Version.');
  }

  return manifest as LiveUpdateManifest;
}

const fetchManifest = async (): Promise<LiveUpdateManifest> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  const requestUrl = new URL(LIVE_UPDATE_MANIFEST_URL);
  requestUrl.searchParams.set('_', Date.now().toString());

  try {
    const response = await fetch(requestUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Manifest-Abruf fehlgeschlagen (${response.status}).`);
    return parseLiveUpdateManifest(await response.json());
  } finally {
    window.clearTimeout(timeoutId);
  }
};

let initializationStarted = false;

export async function initializeLiveUpdates(): Promise<void> {
  if (initializationStarted) return;
  initializationStarted = true;

  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

  try {
    const readyResult = await LiveUpdate.ready();
    if (readyResult.rollback) {
      console.warn('Live Update wurde auf das integrierte Bundle zurückgesetzt.', readyResult);
    }
  } catch (error) {
    console.warn('Live Update konnte nicht als bereit markiert werden.', error);
    return;
  }

  try {
    const manifest = await fetchManifest();
    const [versionResult, currentResult, nextResult, downloadedResult, blockedResult] = await Promise.all([
      LiveUpdate.getVersionCode(),
      LiveUpdate.getCurrentBundle(),
      LiveUpdate.getNextBundle(),
      LiveUpdate.getDownloadedBundles(),
      LiveUpdate.getBlockedBundles()
    ]);

    const nativeVersionCode = Number.parseInt(versionResult.versionCode, 10);
    if (!Number.isInteger(nativeVersionCode)
      || nativeVersionCode < manifest.minimumNativeVersionCode
      || nativeVersionCode > manifest.maximumNativeVersionCode) return;

    if (currentResult.bundleId === manifest.bundleId || nextResult.bundleId === manifest.bundleId) return;
    if (blockedResult.bundleIds.includes(manifest.bundleId)) {
      console.warn(`Live-Update-Bundle ${manifest.bundleId} ist nach einem Rollback blockiert.`);
      return;
    }

    if (!downloadedResult.bundleIds.includes(manifest.bundleId)) {
      await LiveUpdate.downloadBundle({
        artifactType: 'zip',
        bundleId: manifest.bundleId,
        checksum: manifest.checksum,
        signature: manifest.signature,
        url: manifest.downloadUrl
      });
    }

    await LiveUpdate.setNextBundle({ bundleId: manifest.bundleId });
    console.info(`Live-Update-Bundle ${manifest.bundleId} wird beim nächsten App-Start aktiviert.`);
  } catch (error) {
    console.warn('Live-Update-Prüfung wurde ohne Änderung beendet.', error);
  }
}
