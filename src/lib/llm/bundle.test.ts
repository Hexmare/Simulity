import assert from "node:assert/strict";
import { test } from "node:test";
import { asBundle, defaultBundle, liftSettings, resolveEffective } from "./bundle.ts";
import { defaultSettings } from "./settings.ts";
import { AGENT_IDS } from "./prompt-catalog.ts";

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

test("profiles carry timeoutMs 45000 and maxRetries 2 by default", () => {
  const b = defaultBundle();
  assert.equal(b.profiles[0]!.timeoutMs, 45000);
  assert.equal(b.profiles[0]!.maxRetries, 2);
  b.agents.character.overrides = { timeoutMs: 1000, maxRetries: 0 };
  const ch = resolveEffective(b, "character");
  assert.equal(ch.timeoutMs, 1000, "agent-type overrides win");
  assert.equal(ch.maxRetries, 0);
  const dir = resolveEffective(b, "director");
  assert.equal(dir.timeoutMs, 45000, "director inherits the profile");
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

test("context options include 64k/128k/256k (spec 13)", async () => {
  const { CONTEXT_OPTIONS, withDefaults } = await import("./settings.ts");
  assert.ok(CONTEXT_OPTIONS.includes(65536), "64k is a choice");
  assert.ok(CONTEXT_OPTIONS.includes(131072), "128k is a choice");
  assert.ok(CONTEXT_OPTIONS.includes(262144), "256k is a choice");
  assert.equal(withDefaults({ contextTokens: 131072 }).contextTokens, 131072, "128k survives validation");
});

test("defaultBundle ships every registered agent type and asBundle fills gaps", () => {
  const b = defaultBundle();
  for (const id of AGENT_IDS) {
    assert.equal(b.agents[id]?.agentId, id);
  }
  const old = { profiles: b.profiles, agents: { director: b.agents.director, character: b.agents.character } };
  const filled = asBundle(old);
  assert.ok(filled);
  assert.ok(filled.agents.narrator.prompts.system.length > 0);
  assert.ok(filled.agents.world_state.prompts.system.length > 0);
});
