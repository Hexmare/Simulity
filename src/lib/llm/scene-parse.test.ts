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
