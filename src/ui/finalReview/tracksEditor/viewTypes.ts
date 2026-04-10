import type { ClipVolumeEnvelope } from "../../../state/clipAutomation";
import type { EditorSelection } from "../../timeline";

export type TracksEditorSegmentRenderAsset = {
  leftPx: number;
  widthPx: number;
  waveformBarHeights: number[];
  volumeLinePoints: string;
  volumeHandles: {
    id: string;
    leftPercent: number;
    topPercent: number;
    isBoundary: boolean;
  }[];
};

export type TracksEditorSegmentView = {
  id: string;
  trackId: string;
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
  volumeEnvelope: ClipVolumeEnvelope;
  renderAsset: TracksEditorSegmentRenderAsset;
};

export type TracksEditorLaneView = {
  trackId: string;
  displayIndex: number;
  label: string;
  segments: TracksEditorSegmentView[];
  volume: number;
  muted: boolean;
};

export type TracksEditorStaticView = {
  lanes: TracksEditorLaneView[];
  selection: EditorSelection;
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
