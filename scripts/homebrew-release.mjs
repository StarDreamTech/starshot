import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableVersion } from './version.mjs';
import { releaseNames } from './release-manifest.mjs';
import { generateHomebrewCask } from './homebrew-cask.mjs';

export const repository = 'StarDreamTech/starshot';
export const homepage = 'https://github.com/StarDreamTech/starshot';
export const releaseRoot = 'https://github.com/StarDreamTech/starshot/releases';
export const caskDownloadUrl = 'https://github.com/StarDreamTech/starshot/releases/download/v#{version}/Starshot_#{version}_aarch64.dmg';
export const personalTapRepository = 'cpython666/homebrew-tap';
export const personalTapSecret = 'HOMEBREW_TAP_DEPLOY_KEY';
export const personalTapInstall = 'cpython666/tap/starshot';
export const organizationTapRepository = 'StarDreamTech/homebrew-tap';
export const organizationTapSecret = 'HOMEBREW_ORG_TAP_DEPLOY_KEY';
export const organizationTapInstall = 'stardreamtech/tap/starshot';

const shaPattern = /^[a-f0-9]{64}$/;

function assertCanonicalUrls() {
  if (homepage !== `https://github.com/${repository}` || releaseRoot !== `${homepage}/releases`) {
    throw new Error('Cask 主页必须指向 StarDreamTech/starshot。');
  }
  if (caskDownloadUrl !== `${releaseRoot}/download/v#{version}/Starshot_#{version}_aarch64.dmg`) {
    throw new Error('Cask 下载地址必须指向 StarDreamTech/starshot 的 Releases。');
  }
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
}

function versionFromTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Release tag 必须是 vX.Y.Z。');
  return stableVersion(tag.slice(1));
}

function assetSnapshot(release, name, tag) {
  if (!Array.isArray(release.assets)) throw new Error('Release 资产列表无效。');
  const assets = release.assets.filter(asset => asset?.name === name);
  if (assets.length !== 1) throw new Error(`${name} 必须存在且唯一。`);
  const asset = assets[0];
  const url = `${releaseRoot}/download/${tag}/${name}`;
  if (!positiveInteger(asset.id) || !positiveInteger(asset.size) || asset.state !== 'uploaded'
    || asset.browser_download_url !== url || !timestamp(asset.updated_at)) {
    throw new Error(`${name} 资产元数据无效。`);
  }
  if (asset.digest != null && !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error(`${name} 的 GitHub digest 无效。`);
  return { id: asset.id, name, size: asset.size, url, digest: asset.digest ?? null, updatedAt: asset.updated_at };
}

export function prepareRelease(release, latest) {
  assertCanonicalUrls();
  if (!release || typeof release !== 'object') throw new Error('缺少 Release 元数据。');
  if (release.draft === true || release.prerelease === true) return { skip: true, reason: '草稿或预发布版不更新稳定 Cask。' };
  const version = versionFromTag(release.tag_name);
  const tag = `v${version}`;
  const dmgName = releaseNames(version).dmg;
  if (release.draft !== false || release.prerelease !== false || !positiveInteger(release.id)
    || !timestamp(release.published_at) || release.html_url !== `${releaseRoot}/tag/${tag}`) {
    throw new Error('Release 必须是 StarDreamTech/starshot 已公开的稳定版本。');
  }
  if (!latest || release.id !== latest.id || tag !== latest.tag_name) return { skip: true, reason: '只同步当前最新稳定 Release。' };
  if (latest.draft !== false || latest.prerelease !== false || latest.html_url !== release.html_url) throw new Error('最新稳定 Release 元数据不一致。');
  return {
    skip: false, repository, version, tag, dmgName, releaseId: release.id,
    releasePublishedAt: release.published_at,
    dmg: assetSnapshot(release, dmgName, tag), checksums: assetSnapshot(release, 'SHA256SUMS', tag),
  };
}

function validatePlan(plan) {
  assertCanonicalUrls();
  const version = versionFromTag(plan?.tag);
  if (plan.skip !== false || plan.repository !== repository || plan.version !== version
    || plan.dmgName !== releaseNames(version).dmg || !positiveInteger(plan.releaseId)
    || !timestamp(plan.releasePublishedAt)) throw new Error('发布验证计划无效。');
  for (const [asset, name] of [[plan.dmg, plan.dmgName], [plan.checksums, 'SHA256SUMS']]) {
    if (!asset || asset.name !== name || !positiveInteger(asset.id) || !positiveInteger(asset.size)
      || asset.url !== `${releaseRoot}/download/${plan.tag}/${name}` || !timestamp(asset.updatedAt)
      || (asset.digest != null && !/^sha256:[a-f0-9]{64}$/.test(asset.digest))) throw new Error('发布资产快照无效。');
  }
}

function validateEvidence(evidence) {
  validatePlan(evidence);
  if (!shaPattern.test(evidence.sha256 ?? '') || !shaPattern.test(evidence.checksumsSha256 ?? '')) throw new Error('缺少已验证的文件摘要。');
  for (const [asset, digest] of [[evidence.dmg, evidence.sha256], [evidence.checksums, evidence.checksumsSha256]]) {
    if (asset.digest != null && asset.digest !== `sha256:${digest}`) throw new Error('验证摘要与 GitHub digest 不一致。');
  }
}

export function parseChecksums(text) {
  const entries = new Map();
  for (const line of String(text).split(/\r?\n/).filter(line => line.length)) {
    const match = line.match(/^([a-f0-9]{64}) [ *]([A-Za-z0-9][A-Za-z0-9._-]*)$/);
    if (!match) throw new Error('SHA256SUMS 格式或文件名无效；不接受目录路径。');
    if (entries.has(match[2])) throw new Error(`SHA256SUMS 存在重复文件：${match[2]}。`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

async function hashFile(path, expectedSize) {
  const info = await lstat(path);
  if (!info.isFile() || info.size !== expectedSize) throw new Error('下载文件类型或大小与 Release 不一致。');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (bytes !== expectedSize) throw new Error('下载文件在验证中发生变化。');
  return hash.digest('hex');
}

export async function verifyDownload(plan, checksumPath, dmgPath) {
  validatePlan(plan);
  if (basename(dmgPath) !== plan.dmgName) throw new Error('DMG 文件名与发布资产不一致。');
  if (basename(checksumPath) !== 'SHA256SUMS') throw new Error('校验清单文件名必须是 SHA256SUMS。');
  if (plan.checksums.size > 1024 * 1024) throw new Error('SHA256SUMS 超过 1 MiB。');
  const checksumsSha256 = await hashFile(checksumPath, plan.checksums.size);
  const entries = parseChecksums(await readFile(checksumPath, 'utf8'));
  const expected = entries.get(plan.dmgName);
  if (!expected) throw new Error('SHA256SUMS 缺少精确匹配的 DMG 条目。');
  const sha256 = await hashFile(dmgPath, plan.dmg.size);
  if (sha256 !== expected) throw new Error('DMG 的 SHA-256 与 SHA256SUMS 不一致。');
  const evidence = { ...plan, sha256, checksumsSha256 };
  validateEvidence(evidence);
  return evidence;
}

export function assertReleaseUnchanged(evidence, release, latest) {
  validateEvidence(evidence);
  const current = prepareRelease(release, latest);
  if (current.skip) throw new Error(`发布状态已变化：${current.reason}`);
  for (const key of ['releaseId', 'releasePublishedAt', 'version', 'tag', 'dmgName', 'dmg', 'checksums']) {
    if (JSON.stringify(current[key]) !== JSON.stringify(evidence[key])) throw new Error(`验证后 Release 或资产已变化：${key}。请重新验证。`);
  }
}

function assertCaskText(text, evidence) {
  assertCanonicalUrls();
  const required = [
    'cask "starshot" do', `version "${evidence.version}"`, `sha256 "${evidence.sha256}"`,
    `url "${caskDownloadUrl}"`, 'name "Starshot"', 'name "星镜"', `homepage "${homepage}"`,
    'strategy :github_latest', 'auto_updates true', 'depends_on arch: :arm64', 'depends_on macos: :monterey',
    'app "Starshot.app"', 'not Apple-notarized', `${releaseRoot}/tag/${evidence.tag}`,
  ];
  if ([...text.matchAll(/^cask "starshot" do$/gm)].length !== 1 || required.some(line => !text.includes(line))) {
    throw new Error('生成的 Cask 与 StarDreamTech/starshot 发布模板不一致。');
  }
  if (text.includes('cpython666') || /:no_check|\bzap\b|\buninstall\b|quarantine/.test(text)) {
    throw new Error('Cask 包含旧地址或不应出现的字段。');
  }
}

export async function createCask(evidence, dmgPath, outputPath) {
  validateEvidence(evidence);
  if (basename(outputPath) !== 'starshot.rb') throw new Error('Cask 输出文件名必须是 starshot.rb。');
  const directory = await mkdtemp(join(tmpdir(), 'starshot-cask-'));
  try {
    const result = await generateHomebrewCask({ dmgPath, outputPath: join(directory, 'starshot.rb'), version: evidence.version, tag: evidence.tag });
    if (result.sha256 !== evidence.sha256) throw new Error('Cask 摘要与已核验 DMG 不一致。');
    const text = await readFile(result.outputPath, 'utf8');
    assertCaskText(text, evidence);
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, text);
    return { version: evidence.version, sha256: evidence.sha256, outputPath: resolve(outputPath) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function currentCask(text) {
  const version = [...text.matchAll(/^  version "([^"\r\n]+)"$/gm)];
  const sha = [...text.matchAll(/^  sha256 "([a-f0-9]{64})"$/gm)];
  if ([...text.matchAll(/^cask "starshot" do$/gm)].length !== 1 || version.length !== 1 || sha.length !== 1) {
    throw new Error('现有 Cask 的名称、版本或 SHA-256 不唯一。');
  }
  const parts = version[0][1].match(/^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-(alpha|beta|rc)\.(?:0|[1-9]\d*))?$/);
  if (!parts) throw new Error('现有 Cask 版本格式不受支持。');
  return { version: parts[1], prerelease: Boolean(parts[2]), sha256: sha[0][1] };
}

function compareVersions(left, right) {
  const wanted = left.split('.').map(part => BigInt(part));
  const existing = right.split('.').map(part => BigInt(part));
  for (let index = 0; index < wanted.length; index += 1) {
    if (wanted[index] === existing[index]) continue;
    return wanted[index] > existing[index] ? 1 : -1;
  }
  return 0;
}

export async function applyCask(evidence, generatedPath, destinationPath) {
  validateEvidence(evidence);
  if (basename(generatedPath) !== 'starshot.rb' || basename(destinationPath) !== 'starshot.rb') throw new Error('只能更新 starshot.rb。');
  const generatedInfo = await lstat(generatedPath);
  const destinationInfo = await lstat(destinationPath);
  if (!generatedInfo.isFile() || !destinationInfo.isFile()) throw new Error('Cask 必须是普通文件。');
  const generated = await readFile(generatedPath, 'utf8');
  assertCaskText(generated, evidence);
  const existingText = await readFile(destinationPath, 'utf8');
  if (existingText === generated) return { changed: false, reason: `Tap 的 Cask 已与 ${evidence.version} 一致，未改动。`, version: evidence.version, sha256: evidence.sha256 };
  const current = currentCask(existingText);
  const order = compareVersions(evidence.version, current.version);
  if (order < 0) return { changed: false, reason: `Tap 已有 ${current.version}，不降级到 ${evidence.version}。` };
  if (order === 0 && !current.prerelease) {
    if (current.sha256 !== evidence.sha256) throw new Error('同版本安装包 SHA-256 已变化，拒绝覆盖已发布 Cask。');
    return { changed: false, reason: `Tap 已是 ${evidence.version}，未改动。`, version: evidence.version, sha256: evidence.sha256 };
  }
  const temporary = `${destinationPath}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  try {
    await writeFile(temporary, generated, { flag: 'wx' });
    await rename(temporary, destinationPath);
  } finally {
    await rm(temporary, { force: true });
  }
  return { changed: true, version: evidence.version, sha256: evidence.sha256, reason: `已将 Cask 更新到 ${evidence.version}。` };
}

const tapKeyCopy = {
  personal: {
    env: personalTapSecret,
    skip: `未配置 ${personalTapSecret}，已跳过 ${personalTapRepository}。组织 Tap ${organizationTapRepository}（${organizationTapSecret}）不因此失败。`,
    ready: `将使用 ${personalTapSecret} 推送 ${personalTapRepository}。`,
  },
  organization: {
    env: organizationTapSecret,
    skip: `未配置 ${organizationTapSecret}，已跳过 ${organizationTapRepository}。个人 Tap ${personalTapRepository}（${personalTapSecret}）不因此失败。`,
    ready: `将使用 ${organizationTapSecret} 推送 ${organizationTapRepository}。`,
  },
};

/** Blank or missing deploy keys skip that Tap. The other Tap is a separate job. */
export function tapKeyDecision(kind, secret) {
  const copy = tapKeyCopy[kind];
  if (!copy) throw new Error('未知的 Tap。');
  if (typeof secret !== 'string' || secret.trim() === '') return { configured: false, reason: copy.skip };
  return { configured: true, reason: copy.ready };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === 'prepare' && args.length === 3) {
      const plan = prepareRelease(await json(args[0]), await json(args[1]));
      await writeFile(args[2], `${JSON.stringify(plan, null, 2)}\n`);
      result = plan.skip ? plan : { skip: false, version: plan.version, tag: plan.tag, dmgName: plan.dmgName };
    } else if (command === 'verify' && args.length === 4) {
      const evidence = await verifyDownload(await json(args[0]), args[1], args[2]);
      await writeFile(args[3], `${JSON.stringify(evidence, null, 2)}\n`);
      result = { version: evidence.version, tag: evidence.tag, dmgName: evidence.dmgName, sha256: evidence.sha256 };
    } else if (command === 'cask' && args.length === 3) result = await createCask(await json(args[0]), args[1], args[2]);
    else if (command === 'recheck' && args.length === 3) {
      assertReleaseUnchanged(await json(args[0]), await json(args[1]), await json(args[2]));
      result = { unchanged: true };
    } else if (command === 'apply' && args.length === 3) result = await applyCask(await json(args[0]), args[1], args[2]);
    else if (command === 'tap-key' && args.length === 2 && (args[0] === 'personal' || args[0] === 'organization')) {
      const envName = args[0] === 'personal' ? personalTapSecret : organizationTapSecret;
      result = tapKeyDecision(args[0], process.env[envName]);
      await writeFile(args[1], `${JSON.stringify(result)}\n`);
    } else {
      throw new Error('用法：homebrew-release.mjs prepare <release.json> <latest-release.json> <plan.json> | verify <plan.json> <SHA256SUMS> <dmg> <evidence.json> | cask <evidence.json> <dmg> <starshot.rb> | recheck <evidence.json> <release.json> <latest-release.json> | apply <evidence.json> <starshot.rb> <目标 starshot.rb> | tap-key <personal|organization> <decision.json>');
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
