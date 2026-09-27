import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPendingSms } from "./sms";

test("pending SMS: ready, choose, and junk", () => {
  const ready = formatPendingSms({ text: "დავაგვიანებ", to: "დედა" })!;
  assert.match(ready, /მიმღები დედა/);
  assert.match(ready, /confirm_sms/);

  const choose = formatPendingSms({
    text: "გამარჯობა",
    options: ["ნინო ბერიძე", "ნინო კაპანაძე", 42],
  })!;
  assert.match(choose, /ნინო ბერიძე, ნინო კაპანაძე\./);

  assert.equal(formatPendingSms(undefined), null);
  assert.equal(formatPendingSms({ to: "დედა" }), null); // no text
  assert.equal(formatPendingSms({ text: "hi" }), null); // no recipient
  assert.ok(formatPendingSms({ text: "x".repeat(2000), to: "a" })!.length < 800);
});
