const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");

const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
const config = JSON.parse(fs.readFileSync(__dirname + "/../site-config.json", "utf8"));
const get = (path) => path.split(".").reduce((n, k) => (n ? n[k] : undefined), config);

const tagsWith = (name) => html.match(new RegExp(String.raw`<[a-z0-9]+[^>]*\s${name}="[^"]+"[^>]*>`, "gi")) || [];
const attr = (tag, name) => (tag.match(new RegExp(String.raw`\s${name}="([^"]*)"`)) || [])[1];

test("every configurable link exists in site-config.json and the HTML default matches it", () => {
  const tags = tagsWith("data-cfg-href");
  assert.ok(tags.length >= 8);
  for (const tag of tags) {
    const key = attr(tag, "data-cfg-href");
    assert.equal(get(key), attr(tag, "href"), `default href for ${key} must equal site-config.json`);
  }
});

test("every configurable text exists in site-config.json and matches the HTML default", () => {
  for (const m of html.matchAll(/data-cfg-text="([^"]+)"[^>]*>([^<]*)</g)) {
    const [, key, text] = m;
    assert.equal(typeof get(key), "string", `missing config key ${key}`);
    assert.equal(text.replace(/&amp;/g, "&").trim(), get(key).trim(), `default text for ${key}`);
  }
});

test("configured links are https or tel only", () => {
  const urls = [];
  (function walk(node) {
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") walk(v);
      else if (k === "url") urls.push(v);
    }
  })(config.insurance);
  assert.ok(urls.length >= 8);
  for (const url of urls) assert.match(url, /^(https:\/\/|tel:\+1\d{10}$)/, url);
});

test("no dead or decorative links: no href=\"#\", every in-page anchor has a target", () => {
  assert.ok(!/href="#"/.test(html));
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `anchor #${m[1]} has no target`);
});

test("external links open safely", () => {
  for (const m of html.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) assert.match(m[0], /rel="[^"]*noopener/, m[0]);
});

test("the site collects no personal or health information itself", () => {
  const forms = [...html.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(forms.length, 1, "only the news search form exists");
  assert.match(forms[0], /id="filters"/);
  assert.ok(!/type="(email|tel|password)"/.test(html));
});

test("the insurance section is labelled as a business service and discloses the licence", () => {
  assert.match(config.insurance.sectionLabel, /Not part of the news/i);
  assert.match(config.insurance.licenseLine, /NPN \d+/);
  assert.match(config.insurance.privacyNote, /medical or health details/i);
});

test("insurance can be switched off without touching code", () => {
  assert.equal(config.insurance.enabled, true);
  const flagged = html.match(/<[a-z0-9]+[^>]*\sdata-insurance[\s>]/g) || [];
  assert.ok(flagged.length >= 3, "nav link, promo and section carry data-insurance");
});
