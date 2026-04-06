import type { ClipVolumeEnvelope } from "../../../state/clipAutomation";
import type { EditorSelection, WaveformPeaks } from "../../timeline";

export type TracksEditorSegmentView = {
  id: string;
  trackId: string;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
  volumeEnvelope: ClipVolumeEnvelope;
};

export type TracksEditorLaneView = {
  trackId: string;
  displayIndex: number;
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
  beatSec: number;
  reverbWet: number;
  exporting: boolean;
  isPlaying: boolean;
  isSyncingFrames: boolean;
  syncWarning: string | null;
  canSplit: boolean;
  canDelete: boolean;
};
