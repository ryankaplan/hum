import { describe, expect, it } from "vitest";
import { generateHarmony, parseHarmonyInput } from "../src/index";

function parse(source: string) {
  const result = parseHarmonyInput(source, { beatsPerBar: 4 });
  if (!result.ok) {
    throw new Error(result.issues.map((issue) => issue.message).join("\n"));
  }
  return result.value;
}

describe("generateHarmony", () => {
  it("returns lines, annotations, and timed voices together", () => {
    const harmony = generateHarmony(parse("A9"), {
      range: { low: 48, high: 72 },
      voices: 3,
    });

    expect(harmony.lines).toHaveLength(3);
    expect(harmony.annotations).toHaveLength(1);
    expect(harmony.timedVoices).toHaveLength(3);
    expect(harmony.timedVoices[0]?.events[0]).toMatchObject({
      startBeat: 0,
      durationBeats: 4,
    });
  });

  it("supports a one-voice harmony mode", () => {
    const harmony = generateHarmony(parse("A"), {
      range: { low: 48, high: 72 },
      voices: 1,
    });

    expect(harmony.lines).toHaveLength(1);
    expect(harmony.timedVoices).toHaveLength(1);
  });

  it("throws when the vocal range is invalid", () => {
    expect(() =>
      generateHarmony(parse("A"), {
        range: { low: 72, high: 48 },
        voices: 3,
      }),
    ).toThrow(RangeError);
  });
});
