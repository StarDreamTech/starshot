import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyCask, assertReleaseUnchanged, caskDownloadUrl, createCask, homepage,
  organizationTapInstall, organizationTapRepository, organizationTapSecret, parseChecksums, personalTapInstall,
  personalTapRepository, personalTapSecret, prepareRelease, releaseRoot, repository, tapKeyDecision, verifyDownload,
} from '../scripts/homebrew-release.mjs';

const publishedAt = '2026-11-10T16:26:09Z';
const scriptPath = fileURLToPath(new URL('../scripts/homebrew-release.mjs', import.meta.url));

function asset(name: string, id: number, tag: string, size: number, digest: string | null = null, owner = repository) {
  return {
    id, name, size, state: 'uploaded', digest, updated_at: publishedAt,
    browser_download_url: `https://github.com/${owner}/releases/download/${tag}/${name}`,
  };
}

function releaseFixture(version: string, patch: Record<string, unknown> = {}) {
  const tag = `v${version}`;
  const owner = String(patch.owner ?? repository);
  const size = Number(patch.size ?? 1024);
  const checksumSize = Number(patch.checksumSize ?? 128);
  const dmgName = `Starshot_${version}_aarch64.dmg`;
  const release = {
    id: Number(patch.id ?? 321), tag_name: String(patch.tag_name ?? tag),
    draft: patch.draft ?? false, prerelease: patch.prerelease ?? false,
    published_at: String(patch.published_at ?? publishedAt),
    html_url: String(patch.html_url ?? `https://github.com/${owner}/releases/tag/${tag}`),
    assets: patch.assets ?? [
      asset(dmgName, 11, tag, size, patch.digest as string | null ?? null, owner),
      asset('SHA256SUMS', 12, tag, checksumSize, patch.checksumDigest as string | null ?? null, owner),
    ],
  };
  return { release, latest: patch.latest === undefined ? release : patch.latest };
}

function syntheticDmg(label: string) {
  const bytes = Buffer.alloc(1024);
  bytes.write(label);
  bytes.write('koly', 512);
  return bytes;
}

async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'starshot-homebrew-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function verified(directory: string, version: string, bytes = syntheticDmg(version)) {
  const dmgName = `Starshot_${version}_aarch64.dmg`;
  const dmgPath = join(directory, dmgName);
  const sumsPath = join(directory, 'SHA256SUMS');
  await writeFile(dmgPath, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sums = `${sha256}  ${dmgName}\n${'b'.repeat(64)}  latest.json\n`;
  await writeFile(sumsPath, sums);
  const { release, latest } = releaseFixture(version, { size: bytes.length, checksumSize: Buffer.byteLength(sums) });
  const plan = prepareRelease(release, latest);
  assert.equal(plan.skip, false);
  const evidence = await verifyDownload(plan, sumsPath, dmgPath);
  return { dmgPath, sumsPath, sha256, release, latest, evidence, plan };
}

test('Cask 地址固定指向 StarDreamTech/starshot 的 Release', () => {
  assert.equal(repository, 'StarDreamTech/starshot');
  assert.equal(homepage, 'https://github.com/StarDreamTech/starshot');
  assert.equal(releaseRoot, 'https://github.com/StarDreamTech/starshot/releases');
  assert.equal(caskDownloadUrl, 'https://github.com/StarDreamTech/starshot/releases/download/v#{version}/Starshot_#{version}_aarch64.dmg');
  assert.equal(personalTapRepository, 'cpython666/homebrew-tap');
  assert.equal(personalTapSecret, 'HOMEBREW_TAP_DEPLOY_KEY');
  assert.equal(personalTapInstall, 'cpython666/tap/starshot');
  assert.equal(organizationTapRepository, 'StarDreamTech/homebrew-tap');
  assert.equal(organizationTapSecret, 'HOMEBREW_ORG_TAP_DEPLOY_KEY');
  assert.equal(organizationTapInstall, 'stardreamtech/tap/starshot');
});

test('只准备指定仓库的最新公开稳定版，草稿、预发布和旧版跳过', () => {
  const stable = releaseFixture('0.3.2');
  const plan = prepareRelease(stable.release, stable.latest);
  assert.equal(plan.skip, false);
  if (plan.skip) return;
  assert.equal(plan.repository, 'StarDreamTech/starshot');
  assert.equal(plan.dmg.url, 'https://github.com/StarDreamTech/starshot/releases/download/v0.3.2/Starshot_0.3.2_aarch64.dmg');
  assert.equal(prepareRelease({ ...stable.release, draft: true }, stable.latest).skip, true);
  assert.equal(prepareRelease({ ...stable.release, prerelease: true, tag_name: 'v0.3.2-rc.1' }, stable.latest).skip, true);
  const older = releaseFixture('0.3.1', { id: 9 });
  assert.equal(prepareRelease(older.release, stable.release).skip, true);
  assert.equal(prepareRelease(stable.release, null).skip, true);
});

test('拒绝旧仓库地址、注入 tag、缺失或重复资产', () => {
  const stable = releaseFixture('0.3.2');
  const wrongOwner = releaseFixture('0.3.2', { owner: 'cpython666/starshot' });
  assert.throws(() => prepareRelease(wrongOwner.release, wrongOwner.latest), /StarDreamTech\/starshot/);
  assert.throws(() => prepareRelease({ ...stable.release, tag_name: 'v0.3.2\nrm' }, stable.latest), /tag|版本/);
  assert.throws(() => prepareRelease({ ...stable.release, html_url: 'https://github.com/StarDreamTech/starshot/releases/tag/v9.9.9' }, stable.latest), /稳定版本/);
  assert.throws(() => prepareRelease({ ...stable.release, assets: stable.release.assets.slice(0, 1) }, stable.latest), /SHA256SUMS/);
  const duplicated = { ...stable.release, assets: [...stable.release.assets, stable.release.assets[0]] };
  assert.throws(() => prepareRelease(duplicated, duplicated), /唯一/);
  const unfinished = { ...stable.release, assets: stable.release.assets.map(item => ({ ...item, state: 'starter' })) };
  assert.throws(() => prepareRelease(unfinished, unfinished), /资产元数据/);
});

test('校验清单拒绝路径、重复条目、单空格和无效摘要', () => {
  const hash = 'a'.repeat(64);
  parseChecksums(`${hash}  Starshot_0.3.2_aarch64.dmg\n`);
  parseChecksums(`${hash} *Starshot_0.3.2_aarch64.dmg\n`);
  assert.throws(() => parseChecksums(`${hash}  ../Starshot_0.3.2_aarch64.dmg\n`), /格式或文件名/);
  assert.throws(() => parseChecksums(`${hash}  Starshot_0.3.2_aarch64.dmg\n${hash}  Starshot_0.3.2_aarch64.dmg\n`), /重复/);
  assert.throws(() => parseChecksums(`${hash} Starshot_0.3.2_aarch64.dmg\n`), /格式或文件名/);
  assert.throws(() => parseChecksums(`${'A'.repeat(64)}  Starshot_0.3.2_aarch64.dmg\n`), /格式或文件名/);
  assert.throws(() => parseChecksums(`${hash}  Starshot_0.3.2_aarch64.dmg;rm\n`), /格式或文件名/);
});

test('按真实字节、大小和 GitHub digest 核验下载文件', async t => {
  const directory = await temporary(t);
  const bytes = syntheticDmg('checked-starshot');
  const result = await verified(directory, '0.3.2', bytes);
  assert.equal(result.evidence.sha256, result.sha256);
  const withDigest = releaseFixture('0.3.2', {
    size: bytes.length,
    checksumSize: (await readFile(result.sumsPath)).length,
    digest: `sha256:${result.sha256}`,
  });
  const plan = prepareRelease(withDigest.release, withDigest.latest);
  const evidence = await verifyDownload(plan, result.sumsPath, result.dmgPath);
  assert.equal(evidence.dmg.digest, `sha256:${result.sha256}`);
  bytes[0] ^= 1;
  await writeFile(result.dmgPath, bytes);
  await assert.rejects(verifyDownload(plan, result.sumsPath, result.dmgPath), /SHA-256|大小/);
});

test('拒绝损坏包、错误摘要、清单缺条目和推送前的版本变化', async t => {
  const directory = await temporary(t);
  const result = await verified(directory, '0.3.2');
  const brokenSums = join(directory, 'SHA256SUMS');
  const originalSums = await readFile(brokenSums, 'utf8');
  await writeFile(brokenSums, originalSums.replace(result.sha256, 'c'.repeat(64)));
  await assert.rejects(verifyDownload(result.plan, brokenSums, result.dmgPath), /SHA-256/);
  await writeFile(brokenSums, `${result.sha256}  other.dmg\n`);
  await assert.rejects(verifyDownload(result.plan, brokenSums, result.dmgPath), /精确匹配|大小/);
  await writeFile(brokenSums, originalSums);
  const tampered = { ...result.evidence, sha256: 'd'.repeat(64), dmg: { ...result.evidence.dmg, digest: `sha256:${'d'.repeat(64)}` } };
  assert.throws(() => assertReleaseUnchanged(tampered, result.release, result.latest), /digest|摘要|计划|资产/);
  assert.throws(() => assertReleaseUnchanged(result.evidence, { ...result.release, draft: true }, result.latest), /发布状态已变化/);
  const replaced = {
    ...result.release,
    assets: result.release.assets.map(item => item.name === 'SHA256SUMS' ? { ...item, updated_at: '2026-11-11T00:00:00Z' } : item),
  };
  assert.throws(() => assertReleaseUnchanged(result.evidence, replaced, replaced), /已变化/);
  assertReleaseUnchanged(result.evidence, result.release, result.latest);
});

test('生成的 Cask 绑定已核验 DMG，并只向前更新 starshot.rb', async t => {
  const directory = await temporary(t);
  const olderDirectory = join(directory, 'older');
  const newerDirectory = join(directory, 'newer');
  await mkdir(olderDirectory);
  await mkdir(newerDirectory);
  const current = await verified(directory, '0.3.2');
  const outputPath = join(directory, 'starshot.rb');
  await createCask(current.evidence, current.dmgPath, outputPath);
  const generated = await readFile(outputPath, 'utf8');
  assert.match(generated, new RegExp(caskDownloadUrl.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(generated, /homepage "https:\/\/github\.com\/StarDreamTech\/starshot"/);
  assert.match(generated, /strategy :github_latest/);
  assert.doesNotMatch(generated, /cpython666|:no_check|\bzap\b|quarantine/);
  const destination = join(directory, 'Casks/starshot.rb');
  await mkdir(join(directory, 'Casks'));
  const previous = `cask "starshot" do\n  version "0.3.1"\n  sha256 "${'a'.repeat(64)}"\nend\n`;
  await writeFile(destination, previous);
  const updated = await applyCask(current.evidence, outputPath, destination);
  assert.equal(updated.changed, true);
  assert.equal(await readFile(destination, 'utf8'), generated);
  const again = await applyCask(current.evidence, outputPath, destination);
  assert.equal(again.changed, false);
  assert.equal(await readFile(destination, 'utf8'), generated);
  const older = await verified(olderDirectory, '0.3.1');
  const olderCask = join(olderDirectory, 'starshot.rb');
  await createCask(older.evidence, older.dmgPath, olderCask);
  const downgrade = await applyCask(older.evidence, olderCask, destination);
  assert.equal(downgrade.changed, false);
  assert.match(String(downgrade.reason), /不降级/);
  assert.equal(await readFile(destination, 'utf8'), generated);
  const sameBytes = generated.replace(`sha256 "${current.sha256}"`, `sha256 "${'e'.repeat(64)}"`);
  await writeFile(destination, sameBytes);
  await assert.rejects(applyCask(current.evidence, outputPath, destination), /SHA-256 已变化/);
  assert.equal(await readFile(destination, 'utf8'), sameBytes);
  const prerelease = generated.replace('version "0.3.2"', 'version "0.3.2-rc.1"');
  await writeFile(destination, prerelease);
  assert.equal((await applyCask(current.evidence, outputPath, destination)).changed, true);
  const newer = await verified(newerDirectory, '0.10.0');
  const newerCask = join(newerDirectory, 'starshot.rb');
  await createCask(newer.evidence, newer.dmgPath, newerCask);
  await writeFile(destination, generated.replace('version "0.3.2"', 'version "0.9.0"'));
  assert.equal((await applyCask(newer.evidence, newerCask, destination)).changed, true);
  assert.equal((await applyCask(current.evidence, outputPath, destination)).changed, false);
});

test('错误地址、符号链接和错误文件名都不会改写目标 Cask', async t => {
  const directory = await temporary(t);
  const current = await verified(directory, '0.3.2');
  const outputPath = join(directory, 'starshot.rb');
  await createCask(current.evidence, current.dmgPath, outputPath);
  const wrongSha = { ...current.evidence, sha256: 'f'.repeat(64) };
  const rejected = join(directory, 'rejected.rb');
  await assert.rejects(createCask(wrongSha, current.dmgPath, outputPath), /摘要与已核验 DMG 不一致/);
  await assert.rejects(createCask(current.evidence, current.dmgPath, rejected), /输出文件名/);
  const destination = join(directory, 'Casks/starshot.rb');
  await mkdir(join(directory, 'Casks'));
  const original = `cask "starshot" do\n  version "0.3.0"\n  sha256 "${'a'.repeat(64)}"\nend\n`;
  await writeFile(destination, original);
  const forged = join(directory, 'forged/starshot.rb');
  await mkdir(join(directory, 'forged'));
  await writeFile(forged, (await readFile(outputPath, 'utf8')).replaceAll('StarDreamTech/starshot', 'cpython666/starshot'));
  await assert.rejects(applyCask(current.evidence, forged, destination), /模板不一致|旧地址/);
  assert.equal(await readFile(destination, 'utf8'), original);
  const link = join(directory, 'linked/starshot.rb');
  await mkdir(join(directory, 'linked'));
  await symlink(destination, link);
  await assert.rejects(applyCask(current.evidence, outputPath, link), /普通文件/);
  assert.equal(await readFile(destination, 'utf8'), original);
  await assert.rejects(applyCask(current.evidence, outputPath, join(directory, 'Casks/starclip.rb')), /starshot\.rb/);
});

test('任一 Tap 密钥缺失都跳过，且判断结果不包含密钥正文', async t => {
  for (const kind of ['personal', 'organization'] as const) {
    assert.equal(tapKeyDecision(kind, undefined).configured, false);
    assert.equal(tapKeyDecision(kind, '').configured, false);
    assert.equal(tapKeyDecision(kind, ' \n\t').configured, false);
    const present = tapKeyDecision(kind, '-----BEGIN OPENSSH PRIVATE KEY-----\nsuper-secret-line\n');
    assert.equal(present.configured, true);
    assert.doesNotMatch(JSON.stringify(present), /super-secret-line|BEGIN OPENSSH/);
  }
  assert.match(tapKeyDecision('personal', '').reason, /未配置 HOMEBREW_TAP_DEPLOY_KEY/);
  assert.match(tapKeyDecision('personal', '').reason, /组织 Tap StarDreamTech\/homebrew-tap/);
  assert.match(tapKeyDecision('organization', '').reason, /未配置 HOMEBREW_ORG_TAP_DEPLOY_KEY/);
  assert.match(tapKeyDecision('organization', '').reason, /个人 Tap cpython666\/homebrew-tap/);
  const directory = await temporary(t);
  const output = join(directory, 'tap-key.json');
  const secret = '-----BEGIN OPENSSH PRIVATE KEY-----\nsuper-secret-line\n';
  for (const [kind, envName] of [['personal', 'HOMEBREW_TAP_DEPLOY_KEY'], ['organization', 'HOMEBREW_ORG_TAP_DEPLOY_KEY']] as const) {
    const leaked = spawnSync(process.execPath, [scriptPath, 'tap-key', kind, output], {
      encoding: 'utf8',
      env: { ...process.env, [envName]: secret },
    });
    assert.equal(leaked.status, 0, leaked.stderr);
    assert.doesNotMatch(`${leaked.stdout}${leaked.stderr}${await readFile(output, 'utf8')}`, /super-secret-line|BEGIN OPENSSH/);
    const absentEnv = { ...process.env };
    delete absentEnv[envName];
    const absent = spawnSync(process.execPath, [scriptPath, 'tap-key', kind, output], { encoding: 'utf8', env: absentEnv });
    assert.equal(absent.status, 0, absent.stderr);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).configured, false);
  }
});

test('两个 Tap 任务互不依赖，密钥缺失时写明跳过', async () => {
  const workflow = await readFile(new URL('../.github/workflows/homebrew.yml', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const guide = await readFile(new URL('../docs/homebrew.md', import.meta.url), 'utf8');
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(workflow, /github\.repository == 'StarDreamTech\/starshot'/);
  assert.doesNotMatch(workflow, /github\.repository == 'cpython666\//);
  assert.match(workflow, /if: steps\.personal_key\.outputs\.configured == 'true'[\s\S]*?repository: cpython666\/homebrew-tap[\s\S]*?ssh-key: \$\{\{ secrets\.HOMEBREW_TAP_DEPLOY_KEY \}\}/);
  assert.match(workflow, /if: steps\.org_key\.outputs\.configured == 'true'[\s\S]*?repository: StarDreamTech\/homebrew-tap[\s\S]*?ssh-key: \$\{\{ secrets\.HOMEBREW_ORG_TAP_DEPLOY_KEY \}\}/);
  assert.match(workflow, new RegExp(escapeRegExp(tapKeyDecision('personal', '').reason)));
  assert.match(workflow, new RegExp(escapeRegExp(tapKeyDecision('organization', '').reason)));
  assert.match(workflow, /::notice title=个人 Tap 已跳过::/);
  assert.match(workflow, /::notice title=组织 Tap 已跳过::/);
  assert.doesNotMatch(workflow, /Missing HOMEBREW_TAP_DEPLOY_KEY repository secret/);
  assert.equal([...workflow.matchAll(/^ {4}needs: verify$/gm)].length, 2);
  assert.doesNotMatch(workflow, /needs:.*update-tap/);
  assert.doesNotMatch(workflow, /needs:.*update-org-tap/);
  assert.match(readme, /brew install --cask cpython666\/tap\/starshot/);
  assert.match(readme, /brew install --cask stardreamtech\/tap\/starshot/);
  for (const text of [workflow, guide]) {
    assert.match(text, /HOMEBREW_TAP_DEPLOY_KEY/);
    assert.match(text, /HOMEBREW_ORG_TAP_DEPLOY_KEY/);
    assert.match(text, /cpython666\/homebrew-tap/);
    assert.match(text, /StarDreamTech\/homebrew-tap/);
  }
  assert.match(guide, /跳过/);
});

test('命令行完成本地核验、生成和试应用', async t => {
  const directory = await temporary(t);
  const current = await verified(directory, '0.3.4');
  const releasePath = join(directory, 'release.json');
  const latestPath = join(directory, 'latest-release.json');
  const planPath = join(directory, 'plan.json');
  const evidencePath = join(directory, 'evidence.json');
  const caskPath = join(directory, 'out/starshot.rb');
  const destination = join(directory, 'tap/starshot.rb');
  await mkdir(join(directory, 'tap'));
  await writeFile(destination, `cask "starshot" do\n  version "0.3.0"\n  sha256 "${'a'.repeat(64)}"\nend\n`);
  await writeFile(releasePath, JSON.stringify(current.release));
  await writeFile(latestPath, JSON.stringify(current.latest));
  const run = (...args: string[]) => {
    const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(run('prepare', releasePath, latestPath, planPath).skip, false);
  assert.equal(run('verify', planPath, current.sumsPath, current.dmgPath, evidencePath).sha256, current.sha256);
  assert.equal(run('cask', evidencePath, current.dmgPath, caskPath).sha256, current.sha256);
  assert.equal(run('recheck', evidencePath, releasePath, latestPath).unchanged, true);
  assert.equal(run('apply', evidencePath, caskPath, destination).changed, true);
  assert.match(await readFile(destination, 'utf8'), /homepage "https:\/\/github\.com\/StarDreamTech\/starshot"/);
});
