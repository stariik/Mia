import { test } from "node:test";
import assert from "node:assert/strict";
import { actionLine, formatProfile, formatRecentActions } from "./chatMemory";

test("profile: lists valid facts with ids, drops junk, caps count/length", () => {
  const block = formatProfile([
    { id: "f1", text: "მომხმარებელს დავითი ჰქვია" },
    { id: "f2", text: "" },
    { text: "no id" },
    "garbage",
    { id: "f3", text: "x".repeat(500) },
  ])!;
  assert.match(block, /id=f1: მომხმარებელს დავითი ჰქვია/);
  assert.doesNotMatch(block, /f2|no id|garbage/);
  assert.ok(!block.includes("x".repeat(201)));

  const many = Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, text: "t" }));
  assert.equal(formatProfile(many)!.split("\n").length, 1 + 50);

  assert.equal(formatProfile([]), null);
  assert.equal(formatProfile("nope"), null);
});

test("recent actions: keeps the last 8, null when empty", () => {
  const acts = Array.from({ length: 12 }, (_, i) => `a${i}`);
  const block = formatRecentActions(acts)!;
  assert.match(block, /- a11$/);
  assert.doesNotMatch(block, /- a3\n/);
  assert.equal(block.split("\n").length, 1 + 8);
  assert.equal(formatRecentActions(undefined), null);
});

test("actionLine: compact and truncated", () => {
  assert.equal(
    actionLine("get_weather", { city: "ბათუმი" }, { temp: 13 }),
    'get_weather {"city":"ბათუმი"} → {"temp":13}'
  );
  assert.equal(actionLine("x", {}, { big: "y".repeat(1000) }).length, 300);
});
