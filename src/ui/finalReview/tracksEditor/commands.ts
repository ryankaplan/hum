export type TracksEditorCommand =
  | { type: "split_selected" }
  | { type: "delete_selected" }
  | { type: "select_lane"; trackId: string; timelineSec: number }
  | { type: "select_segment"; trackId: string; clipId: string }
  | { type: "select_volume_point"; trackId: string; clipId: string; pointId: string }
  | { type: "move_segment"; trackId: string; clipId: string; desiredStartSec: number }
  | {
      type: "create_volume_point";
      trackId: string;
      clipId: string;
      pointId: string;
      timeSec: number;
      gainMultiplier: number;
    }
  | {
      type: "move_volume_point";
      trackId: string;
      clipId: string;
      pointId: string;
      timeSec: number;
      gainMultiplier: number;
    }
  | {
      type: "reshape_volume_span";
      trackId: string;
      clipId: string;
      leftPointId: string;
      rightPointId: string;
      leftInnerPointId: string;
      rightInnerPointId: string;
      gainMultiplier: number;
    }
  | { type: "seek"; valueSec: number }
  | { type: "set_lane_volume"; trackId: string; value: number }
  | { type: "toggle_lane_mute"; trackId: string };
