import test from 'node:test';
import assert from 'node:assert/strict';
import { extractNextData, get } from '../dist/index.js';

// These test the site-agnostic core only — no network involved. The scraper's
// live behaviour depends on hosts blocked in the build environment.

test('extractNextData parses embedded Next.js JSON', () => {
  const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    { props: { pageProps: { items: [{ id: 'a' }, { id: 'b' }] } } }
  )}</script></body></html>`;
  const data = extractNextData(html);
  assert.ok(data);
  const items = get(data, 'props.pageProps.items');
  assert.equal(Array.isArray(items) ? items.length : 0, 2);
});

test('extractNextData returns null when the marker is absent', () => {
  assert.equal(extractNextData('<html><body>no data here</body></html>'), null);
});

test('extractNextData returns null on malformed JSON', () => {
  const html =
    '<script id="__NEXT_DATA__" type="application/json">{ not json }</script>';
  assert.equal(extractNextData(html), null);
});

test('get safely returns undefined for missing paths', () => {
  assert.equal(get({ a: { b: 1 } }, 'a.c.d'), undefined);
  assert.equal(get(null, 'a.b'), undefined);
  assert.equal(get({ a: { b: 1 } }, 'a.b'), 1);
});
