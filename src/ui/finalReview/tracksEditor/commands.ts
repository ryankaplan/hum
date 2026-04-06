export type TracksEditorCommand =
  | { type: "split_selected" }
  | { type: "delete_selected" }
  | { type: "toggle_snap" }
  | { type: "select_lane"; laneIndex: number; timelineSec: number }
  | { type: "select_segment"; laneIndex: number; segmentId: string }
  | { type: "move_segment"; laneIndex: number; segmentId: string; desiredStartSec: number }
  | {
      type: "apply_volume_brush";
      laneIndex: number;
      segmentId: string;
      centerSec: number;
      deltaValue: number;
      radiusSec: number;
    }
  | { type: "seek"; valueSec: number }
  | { type: "set_lane_volume"; laneIndex: number; value: number }
  | { type: "toggle_lane_mute"; laneIndex: number };
