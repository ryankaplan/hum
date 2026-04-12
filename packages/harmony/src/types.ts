export type NoteName =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";

export type ChordQuality =
  | "major"
  | "minor"
  | "add9"
  | "diminished"
  | "major6"
  | "minor6"
  | "dominant7"
  | "minor7"
  | "major7"
  | "dominant9"
  | "minor9"
  | "dominant7Flat9"
  | "minor7Flat9"
  | "sus2"
  | "sus4"
  | "dominant9Sus2"
  | "dominant9Sus4";

export type ChordSymbol = {
  root: NoteName;
  quality: ChordQuality;
  bass: NoteName | null;
};

export type MidiNote = number;

export type HarmonyLine = Array<MidiNote | null>;

export type VocalRange = {
  low: MidiNote;
  high: MidiNote;
};

export type HarmonyAnnotation = {
  chordTones: string;
};

export type HarmonyInputEvent = {
  id: string;
  symbol: ChordSymbol;
  sourceText: string;
  lyrics: string;
  startBeat: number;
  durationBeats: number;
};

export type HarmonyMeasureSliceSegmentKind =
  | "single"
  | "start"
  | "middle"
  | "end";

export type HarmonyMeasureSlice = {
  id: string;
  eventIndex: number;
  eventId: string;
  sourceText: string;
  lyrics: string;
  startBeatInMeasure: number;
  durationBeats: number;
  segmentKind: HarmonyMeasureSliceSegmentKind;
};

export type HarmonyMeasure = {
  id: string;
  measureIndex: number;
  slices: HarmonyMeasureSlice[];
};

export type HarmonyInput = {
  beatsPerBar: number;
  events: HarmonyInputEvent[];
  measures: HarmonyMeasure[];
};

export type ParseIssueCode =
  | "empty_input"
  | "invalid_chord_token"
  | "unsupported_text"
  | "not_a_chord_line";

export type ParseIssue = {
  code: ParseIssueCode;
  message: string;
  line: number;
  column: number;
  length: number;
  tokenId?: string;
};

export type ParseResult =
  | {
      ok: true;
      value: HarmonyInput;
    }
  | {
      ok: false;
      issues: ParseIssue[];
    };

export type GenerateHarmonyOptions = {
  range: VocalRange;
  voices: 2 | 3;
};

export type GeneratedHarmonyVoice = {
  events: Array<{
    startBeat: number;
    durationBeats: number;
    midi: MidiNote | null;
  }>;
};

export type GeneratedHarmony = {
  lines: HarmonyLine[];
  annotations: HarmonyAnnotation[];
  timedVoices: GeneratedHarmonyVoice[];
  harmonyTop: MidiNote;
};

export const NOTE_NAMES: NoteName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
