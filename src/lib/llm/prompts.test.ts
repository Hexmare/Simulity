import assert from "node:assert/strict";
import { test } from "node:test";
import { compileBook, compileTemplate, DEFAULT_BOOK, DIRECTOR_BOOK } from "./prompts.ts";
import {
  AGENT_IDS,
  getPromptTemplate,
  shippedBook,
  shippedDef,
  shippedAgents,
} from "./prompt-catalog.ts";
import { asBundle, defaultBundle } from "./bundle.ts";

test("every shipped agent file has a four-field book and matching id", () => {
  assert.equal(shippedAgents().length, AGENT_IDS.length);
  for (const id of AGENT_IDS) {
    const def = shippedDef(id);
    assert.equal(def.id, id);
    assert.ok(def.label.length > 0);
    assert.ok(def.description.length > 0);
    assert.ok(def.status === "active" || def.status === "registered");
    const book = shippedBook(id);
    for (const key of ["system", "character", "snapshot", "deltaSchema"] as const) {
      assert.equal(typeof book[key], "string");
      assert.ok(book[key].trim().length > 0, `${id}.${key} empty`);
    }
  }
});

test("director and character stay active; others are registered this pass", () => {
  assert.equal(shippedDef("director").status, "active");
  assert.equal(shippedDef("character").status, "active");
  for (const id of AGENT_IDS) {
    if (id === "director" || id === "character") continue;
    assert.equal(shippedDef(id).status, "registered", id);
  }
});

test("shipped character/director aliases match the catalog", () => {
  assert.equal(DEFAULT_BOOK.system, shippedBook("character").system);
  assert.equal(DIRECTOR_BOOK.system, shippedBook("director").system);
  assert.ok(DEFAULT_BOOK.system.includes("ONLY ACT AS"));
  assert.ok(DIRECTOR_BOOK.system.includes("never speak"));
  assert.ok(DEFAULT_BOOK.deltaSchema.includes("speech"));
  assert.ok(DEFAULT_BOOK.deltaSchema.includes("social"));
  assert.ok(DEFAULT_BOOK.deltaSchema.includes("chat"));
});

test("compileTemplate substitutes placeholders and blanks unknowns", () => {
  assert.equal(compileTemplate("Hello {{name}} {{missing}}", { name: "Ava" }), "Hello Ava ");
});

test("compileBook appends deltaSchema onto system and renders live snapshot", () => {
  const out = compileBook(shippedBook("character"), {
    name: "Ava Chen",
    setting: "Shadows Veil",
    narrative: { public: "cook", private: "hides a scar", voice: "dry" },
    ancestry: "human",
    job: "cook",
    snapshot: '{"mood":4}',
    guidance: "answer the stew question",
    presence: "here",
    pcCard: "You",
    roster: "Tom",
  });
  assert.ok(out.system.includes("Ava Chen"));
  assert.ok(out.system.includes("ONLY a single JSON object"));
  assert.ok(out.character.includes("answer the stew question"));
  assert.ok(out.live.includes('{"mood":4}'));
});

test("compileBook fills appearance wearing secrets on the character card", () => {
  const out = compileBook(shippedBook("character"), {
    name: "Ava Chen",
    setting: "Shadows Veil",
    narrative: { public: "cook", private: "hides a scar", voice: "dry" },
    ancestry: "human",
    job: "cook",
    snapshot: "{}",
    appearance: "short dark hair, flour on one sleeve",
    wearing: "canvas apron",
    secrets: "keeps a ward-charm in the till",
  });
  assert.ok(out.character.includes("short dark hair"));
  assert.ok(out.character.includes("canvas apron"));
  assert.ok(out.character.includes("ward-charm"));
  assert.ok(out.system.includes("PERSPECTIVE"));
  assert.ok(out.system.includes("called"));
});

test("director book asks for turn balance, not the whole table", () => {
  const sys = shippedBook("director").system;
  assert.ok(sys.includes("never speak"));
  assert.ok(sys.includes("Usually one or two") || sys.includes("not the whole table"));
});

test("getPromptTemplate returns named books and falls back to default", () => {
  const time = getPromptTemplate("narrator", "time");
  assert.ok(time.system.includes("Time has passed") || time.deltaSchema.includes("time"));
  assert.ok(getPromptTemplate("narrator", "sensory").deltaSchema.includes("sensory"));
  assert.ok(getPromptTemplate("narrator", "query").deltaSchema.includes("query"));
  assert.ok(getPromptTemplate("creator", "voice").deltaSchema.includes("underPressure"));
  assert.equal(getPromptTemplate("narrator", "nope").system, shippedBook("narrator").system);
  assert.equal(getPromptTemplate("director").system, shippedBook("director").system);
});

test("defaultBundle includes every agent; asBundle fills missing registered ones", () => {
  const b = defaultBundle();
  for (const id of AGENT_IDS) {
    assert.equal(b.agents[id].agentId, id);
    assert.ok(b.agents[id].prompts.system.length > 0);
  }
  const old = {
    profiles: b.profiles,
    agents: {
      director: b.agents.director,
      character: { ...b.agents.character, prompts: { ...b.agents.character.prompts, system: "CUSTOM" } },
    },
  };
  const filled = asBundle(old);
  assert.ok(filled);
  assert.equal(filled.agents.character.prompts.system, "CUSTOM");
  assert.ok(filled.agents.narrator.prompts.system.includes("Narrator"));
  assert.ok(filled.agents.world_state);
  assert.ok(filled.agents.creator);
  assert.ok(filled.agents.editor);
  assert.ok(filled.agents.memory);
  assert.ok(filled.agents.visual);
  assert.ok(filled.agents.help);
  assert.ok(filled.agents.tts);
  assert.ok(filled.agents.summarizer);
});

test("listed placeholders actually appear in the default book", () => {
  for (const def of shippedAgents()) {
    const blob = `${def.book.system}\n${def.book.character}\n${def.book.snapshot}\n${def.book.deltaSchema}`;
    for (const key of def.placeholders) {
      assert.ok(blob.includes(`{{${key}}}`), `${def.id} lists {{${key}}} but the book does not use it`);
    }
  }
});
