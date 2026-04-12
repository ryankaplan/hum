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

  it("supports a two-voice harmony mode", () => {
    const harmony = generateHarmony(parse("A"), {
      range: { low: 48, high: 72 },
      voices: 2,
    });

    expect(harmony.lines).toHaveLength(2);
    expect(harmony.timedVoices).toHaveLength(2);
  });

  it("keeps defining chord tones in two-voice mode", () => {
    const triad = generateHarmony(parse("Am"), {
      range: { low: 48, high: 72 },
      voices: 2,
    });
    const dominant = generateHarmony(parse("A9"), {
      range: { low: 48, high: 72 },
      voices: 2,
    });

    expect(triad.annotations[0]?.chordTones).toContain("R");
    expect(triad.annotations[0]?.chordTones).toContain("b3");
    expect(dominant.annotations[0]?.chordTones).toContain("3");
    expect(dominant.annotations[0]?.chordTones).toContain("9");
  });

  it("pins slash-chord bass notes in the low voice for two voices", () => {
    const harmony = generateHarmony(parse("E/G#"), {
      range: { low: 48, high: 72 },
      voices: 2,
    });

    expect((harmony.lines[0]?.[0] ?? 0) % 12).toBe(8);
  });

  it("prefers smooth two-voice motion across a progression", () => {
    const harmony = generateHarmony(parse("A D E A"), {
      range: { low: 48, high: 72 },
      voices: 2,
    });
    const upper = harmony.lines[1]?.filter((note): note is number => note != null) ?? [];

    for (let index = 1; index < upper.length; index++) {
      expect(Math.abs(upper[index]! - upper[index - 1]!)).toBeLessThanOrEqual(5);
    }
  });

  it("throws when the vocal range is invalid", () => {
    expect(() =>
      generateHarmony(parse("A"), {
        range: { low: 72, high: 48 },
        voices: 3,
      }),
    ).toThrow(RangeError);
  });

  it("rejects single-voice requests", () => {
    expect(() =>
      generateHarmony(parse("A"), {
        range: { low: 48, high: 72 },
        voices: 1 as unknown as 2 | 3,
      }),
    ).toThrow("Harmony voices must be 2 or 3.");
  });
});
