import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultBundle, liftSettings, resolveEffective } from "./bundle.ts";
import { defaultSettings } from "./settings.ts";

test("resolveEffective follows default and applies agent overrides", () => {
  const b = defaultBundle();
  b.profiles[0]!.maxOutputTokens = 4000;
  b.agents.director.overrides = { maxOutputTokens: 10000 };
  const dir = resolveEffective(b, "director");
  const ch = resolveEffective(b, "character");
  assert.equal(dir.maxOutputTokens, 10000);
  assert.equal(ch.maxOutputTokens, 4000);
  assert.equal(dir.name, b.profiles[0]!.name);
});

test("profileId default follows whichever profile is Default", () => {
  const b = defaultBundle();
  const extra = { ...b.profiles[0]!, id: "other", name: "Other", isDefault: true, maxOutputTokens: 111 };
  b.profiles[0]!.isDefault = false;
  b.profiles.push(extra);
  b.agents.character.profileId = "default";
  const ch = resolveEffective(b, "character");
  assert.equal(ch.id, "other");
  assert.equal(ch.maxOutputTokens, 111);
});

test("named profileId does not move when Default changes", () => {
  const b = defaultBundle();
  const first = b.profiles[0]!;
  const extra = { ...first, id: "other", name: "Other", isDefault: true };
  first.isDefault = false;
  b.profiles.push(extra);
  b.agents.character.profileId = first.id;
  const ch = resolveEffective(b, "character");
  assert.equal(ch.id, first.id);
});

test("liftSettings copies connection knobs and character book", () => {
  const s = defaultSettings();
  s.baseUrl = "http://box.local";
  s.prompts.system = "CUSTOM";
  const b = liftSettings(s);
  assert.equal(b.profiles[0]!.baseUrl, "http://box.local");
  assert.equal(b.agents.character.prompts.system, "CUSTOM");
  assert.ok(b.agents.director.prompts.system.includes("Director"));
});
