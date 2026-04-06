export type TracksEditorCommand =
  | { type: "split_selected" }
  | { type: "delete_selected" }
  | { type: "select_lane"; trackId: string; timelineSec: number }
  | { type: "select_segment"; trackId: string; clipId: string }
  | { type: "move_segment"; trackId: string; clipId: string; desiredStartSec: number }
  | {
      type: "apply_volume_brush";
      trackId: string;
      clipId: string;
      centerSec: number;
      deltaGainMultiplier: number;
      radiusSec: number;
    }
  | { type: "seek"; valueSec: number }
  | { type: "set_lane_volume"; trackId: string; value: number }
  | { type: "toggle_lane_mute"; trackId: string };
