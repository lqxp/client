// Regression tests: re-normalizing an already-normalized message (reaction
// add, deletion, storage reload) must not drop poll/voice kinds. Adding an
// emoji reaction to a poll used to blank `text` → `parsePollLabel("")`
// → kind "text" → the poll vanished from the chat.
// Run: bun test src/composables/useMessenger.test.ts
import "../test-shim";
import { describe, expect, test } from "bun:test";
import { normalizeMessage } from "./useMessenger";

function pollLabel(question: string, options: string[]) {
  const json = JSON.stringify({ q: question, o: options, m: false });
  return `[poll:${Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}]`;
}

describe("normalizeMessage idempotency", () => {
  test("wire poll normalizes to kind poll", () => {
    const msg = normalizeMessage({
      messageId: "m1",
      roomId: "r1",
      text: pollLabel("Best editor?", ["Zed", "VS Code"]),
    });
    expect(msg.kind).toBe("poll");
    expect(msg.poll?.options).toEqual(["Zed", "VS Code"]);
    expect(msg.text).toBe("");
  });

  test("adding a reaction keeps the poll (reported bug)", () => {
    const first = normalizeMessage({
      messageId: "m1",
      roomId: "r1",
      text: pollLabel("Best editor?", ["Zed", "VS Code"]),
    });
    // Same spread applyReactions() does on op 19.
    const second = normalizeMessage(
      { ...first, reactions: [{ emoji: "👍", users: ["bob"], count: 1 }] },
      "r1",
    );
    expect(second.kind).toBe("poll");
    expect(second.poll?.options).toEqual(["Zed", "VS Code"]);
    expect(second.reactions).toHaveLength(1);
  });

  test("re-normalized voice keeps its kind and duration", () => {
    const first = normalizeMessage({ messageId: "v1", roomId: "r1", text: "[voice:1:23]" });
    expect(first.kind).toBe("voice");
    const second = normalizeMessage({ ...first, reactions: [] }, "r1");
    expect(second.kind).toBe("voice");
    expect(second.voiceDuration).toBe("1:23");
  });

  test("deleted poll stays deleted", () => {
    const first = normalizeMessage({
      messageId: "m1",
      roomId: "r1",
      text: pollLabel("Q?", ["A", "B"]),
    });
    const deleted = normalizeMessage({ ...first, text: "", deleted: true }, "r1");
    expect(deleted.kind).toBe("deleted");
  });

  test("plain text round-trips unchanged", () => {
    const first = normalizeMessage({ messageId: "t1", roomId: "r1", text: "hello" });
    const second = normalizeMessage({ ...first }, "r1");
    expect(second.kind).toBe("text");
    expect(second.text).toBe("hello");
  });
});
