import type { ClipAutomation } from "../../../state/clipAutomation";
import type { EditorSelection, WaveformPeaks } from "../../timeline";

export type TracksEditorSegmentView = {
  id: string;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
  automation: ClipAutomation;
};

export type TracksEditorLaneView = {
  laneIndex: number;
  label: string;
  segments: TracksEditorSegmentView[];
  peaks: WaveformPeaks;
  sourceStartSec: number;
  sourceDurationSec: number;
  volume: number;
  muted: boolean;
};

export type TracksEditorView = {
  lanes: TracksEditorLaneView[];
  selection: EditorSelection;
  playheadSec: number;
  timelineEndSec: number;
  beatLineTimes: number[];
  snapToBeat: boolean;
  beatSec: number;
  exporting: boolean;
  isPlaying: boolean;
  isSyncingFrames: boolean;
  syncWarning: string | null;
  canSplit: boolean;
  canDelete: boolean;
};
