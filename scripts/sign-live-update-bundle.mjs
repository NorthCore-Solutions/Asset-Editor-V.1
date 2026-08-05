import { createHash, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const [zipPath, privateKeyPath, bundleId, baseUrl, nativeVersionCode, manifestPath] = process.argv.slice(2);
if (!zipPath || !privateKeyPath || !bundleId || !baseUrl || !nativeVersionCode || !manifestPath) {
  throw new Error('Argumente: ZIP, PrivateKey, BundleId, BaseUrl, NativeVersionCode, ManifestPath');
}

const zipBytes = await readFile(zipPath);
const privateKey = await readFile(privateKeyPath, 'utf8');
const checksum = createHash('sha256').update(zipBytes).digest('hex');
const signature = sign('RSA-SHA256', zipBytes, privateKey).toString('base64');
const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
const versionCode = Number.parseInt(nativeVersionCode, 10);
if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error('Ungültiger NativeVersionCode.');

const manifest = {
  schemaVersion: 1,
  bundleId,
  downloadUrl: `${normalizedBaseUrl}/bundles/${path.basename(zipPath)}`,
  checksum,
  signature,
  minimumNativeVersionCode: versionCode,
  maximumNativeVersionCode: versionCode
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
