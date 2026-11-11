import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { SHARE_BRAND, SHARE_REPOSITORY, SHARE_SITE, SHARE_TEXT } from '../src/share.ts';

test('the share text and poster template use the organization brand', async () => {
  assert.equal(SHARE_BRAND, '星梦科技 StarDreamTech');
  assert.equal(SHARE_SITE, 'https://stardreamtech.github.io/projects/starshot/');
  assert.equal(SHARE_REPOSITORY, 'https://github.com/StarDreamTech/starshot');
  assert.match(SHARE_TEXT, /星梦科技 StarDreamTech/);
  assert.match(SHARE_TEXT, /https:\/\/stardreamtech\.github\.io\/projects\/starshot\//);
  assert.doesNotMatch(`${SHARE_TEXT}\n${SHARE_SITE}\n${SHARE_REPOSITORY}`, /cpython666/);
  const source = await readFile(new URL('../src/share.ts', import.meta.url), 'utf8');
  assert.match(source, /fillText\(SHARE_BRAND/);
  assert.match(source, /fillText\(SHARE_SITE\.replace/);
  assert.doesNotMatch(source, /cpython666/);
});
