import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Rules baked into the shipped 0.3.2 client. Newer builds use StarDreamTech instead. */
export const legacyClientVersion = '0.3.2';
export const legacyEndpoint = 'https://github.com/cpython666/starshot/releases/latest/download/latest.json';
export const legacyDownloadPrefix = 'https://github.com/cpython666/starshot/releases/download/';
const platforms = ['darwin-aarch64', 'windows-x86_64'];

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`版本必须是稳定的 x.y.z，收到 ${value}。`);
  }
  return value.split('.').map(Number);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Decide whether a manifest is one the installed 0.3.2 client could accept.
 * This checks version and download origin only. It does not verify signatures or install a package.
 */
export function assessLegacyUpgrade(manifest, { from = legacyClientVersion } = {}) {
  const reasons = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, from, endpoint: legacyEndpoint, reasons: ['更新清单必须是对象。'] };
  }
  try {
    if (compareVersions(String(manifest.version), from) <= 0) {
      reasons.push(`清单版本 ${manifest.version} 并不高于已安装的 ${from}。`);
    }
  } catch (error) {
    reasons.push(error.message);
  }
  for (const name of platforms) {
    const url = manifest.platforms?.[name]?.url;
    if (typeof url !== 'string' || !url.startsWith(legacyDownloadPrefix)) {
      reasons.push(`${name} 的下载地址不在已安装 ${from} 的白名单 ${legacyDownloadPrefix} 内。`);
    }
  }
  return { ok: reasons.length === 0, from, endpoint: legacyEndpoint, version: manifest.version, reasons };
}

async function readManifest(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [path, ...extra] = process.argv.slice(2);
    if (!path || extra.length) throw new Error('用法：node scripts/legacy-update-check.mjs <latest.json>');
    const result = assessLegacyUpgrade(await readManifest(path));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
