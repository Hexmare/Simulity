import assert from "node:assert/strict";
import { test } from "node:test";
import { parseActs, parseCharacter } from "./scene-parse.ts";

test("parseActs drops unknown, duplicates, and empty", () => {
  const legal = new Set(["a", "b"]);
  assert.deepEqual(
    parseActs(`{"acts":[{"id":"a","guidance":"hi"},{"id":"nope"},{"id":"a"},{"id":"b"}]}`, legal).map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(parseActs("not json", legal), []);
  assert.deepEqual(parseActs(`{"acts":[]}`, legal), []);
});

test("parseCharacter strips location deltas", () => {
  const beat = parseCharacter(
    `{"speech":"hey","action":"nods","deltas":{"mood":2,"location":{"layer":"city","x":1,"y":1}}}`,
  );
  assert.equal(beat.speech, "hey");
  assert.equal(beat.action, "nods");
  assert.equal(beat.deltas.mood, 2);
  assert.equal("location" in beat.deltas, false);
});

test("parseActs extracts JSON from fences and reasoning preamble", () => {
  const legal = new Set(["a", "b"]);
  const fenced = 'Here is who acts:\n```json\n{"acts":[{"id":"a","guidance":"answer","why":"addressed"}]}\n```';
  assert.deepEqual(parseActs(fenced, legal).map((x) => x.id), ["a"]);
  const bare = `[{"id":"b","guidance":"react"}]`;
  assert.deepEqual(parseActs(bare, legal).map((x) => x.id), ["b"]);
});

test("parseCharacter extracts JSON from fences and preamble", () => {
  const beat = parseCharacter('Thinking out loud.\n```json\n{"speech":"hey","deltas":{}}\n```');
  assert.equal(beat.speech, "hey");
});

test("parseCharacter never copies raw JSON into speech", () => {
  const garbage = parseCharacter("not json at all, just prose without braces object");
  assert.equal(garbage.speech, "");
  assert.equal(garbage.parseError, true);
  const nested = parseCharacter('{"speech":"{\\"acts\\":[{\\"id\\":\\"x\\"}]}","deltas":{}}');
  assert.equal(nested.speech, "", "speech that looks like JSON is a parse failure");
  assert.equal(nested.parseError, true);
  const empty = parseCharacter('{"speech":"","deltas":{}}');
  assert.equal(empty.speech, "");
  assert.equal(empty.parseError, true);
  const acted = parseCharacter('{"speech":"","action":"nods","deltas":{}}');
  assert.equal(acted.action, "nods", "empty speech + action is legal");
  assert.equal(acted.parseError, undefined);
});

test("parseCharacter reads move / call / task", () => {
  const beat = parseCharacter(
    `{"speech":"coming","move":{"buildingId":"b1","room":"Dining"},"call":{"npcId":"n9"},"task":{"steps":[{"op":"tell","targetId":"n9","content":"hi"}]},"deltas":{}}`,
  );
  assert.equal(beat.speech, "coming");
  assert.equal(beat.move?.buildingId, "b1");
  assert.equal(beat.move?.room, "Dining");
  assert.equal(beat.call?.npcId, "n9");
  assert.equal(beat.task?.steps.length, 1);
});
