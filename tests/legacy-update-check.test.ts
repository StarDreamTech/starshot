import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessLegacyUpgrade,
  legacyDownloadPrefix,
  legacyEndpoint,
} from '../scripts/legacy-update-check.mjs';

const oldUrl = (name: string) => `${legacyDownloadPrefix}v0.3.3/${name}`;
const manifest = (version: string, owner = 'cpython666/starshot') => ({
  version,
  platforms: {
    'darwin-aarch64': { url: `https://github.com/${owner}/releases/download/v${version}/Starshot_${version}_aarch64.app.tar.gz` },
    'windows-x86_64': { url: `https://github.com/${owner}/releases/download/v${version}/Starshot_${version}_x64-setup.exe` },
  },
});

test('the shipped 0.3.2 client only accepts a newer manifest from the old repository', () => {
  assert.equal(legacyEndpoint, 'https://github.com/cpython666/starshot/releases/latest/download/latest.json');
  const current = assessLegacyUpgrade(manifest('0.3.2'));
  assert.equal(current.ok, false);
  assert.match(current.reasons.join('\n'), /并不高于已安装的 0.3.2/);

  const moved = assessLegacyUpgrade(manifest('0.3.3', 'StarDreamTech/starshot'));
  assert.equal(moved.ok, false);
  assert.match(moved.reasons.join('\n'), /darwin-aarch64/);
  assert.match(moved.reasons.join('\n'), /windows-x86_64/);
  assert.doesNotMatch(moved.reasons.join('\n'), /并不高于/);

  const compatible = assessLegacyUpgrade(manifest('0.3.3'));
  assert.equal(compatible.ok, true);
  assert.deepEqual(compatible.reasons, []);
  assert.equal(oldUrl('Starshot_0.3.3_aarch64.app.tar.gz').startsWith(legacyDownloadPrefix), true);
});

test('a legacy manifest missing a platform or a stable version is rejected', () => {
  const partial = manifest('0.3.3');
  delete partial.platforms['windows-x86_64'];
  assert.match(assessLegacyUpgrade(partial).reasons.join('\n'), /windows-x86_64/);
  assert.match(assessLegacyUpgrade({ version: '0.3.3-rc.1', platforms: {} }).reasons.join('\n'), /x\.y\.z/);
  assert.equal(assessLegacyUpgrade(null).ok, false);
});
