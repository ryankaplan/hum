import type { HarmonyPriority } from "./types";

export type HarmonyPriorityProfile = {
  candidate: {
    initialAverageFromCenterWeight: number;
    initialHighFromTargetWeight: number;
    initialRootMismatchPenalty: number;
    initialRootMatchReward: number;
    lowMotionWeight: number;
    highMotionWeight: number;
    lowCommonToneReward: number;
    highCommonToneReward: number;
    sameDirectionPenalty: number;
    sameDirectionLargePenalty: number;
    averageShiftWeight: number;
    rootMismatchPenalty: number;
    missingRootOnChangePenalty: number;
    rootInLowOnChangeReward: number;
    definingToneOnChangeReward: number;
    colorToneOnChangeReward: number;
    ambiguousCarryoverPenalty: number;
  };
  contour: {
    highSpanSoftLimit: number;
    highReversalAfterNonStepPenalty: number;
    highRepeatedReversalPenalty: number;
    highUnrecoveredLeapPenalty: number;
    highSpanExcessPenalty: number;
    highCommonToneReward: number;
    lowSpanSoftLimit: number;
    lowReversalAfterNonStepPenalty: number;
    lowRepeatedReversalPenalty: number;
    lowUnrecoveredLeapPenalty: number;
    lowSpanExcessPenalty: number;
    lowCommonToneReward: number;
    sameDirectionLargeMotionPenalty: number;
    sameDirectionBothActivePenalty: number;
  };
};

const BASE_PROFILE: HarmonyPriorityProfile = {
  candidate: {
    initialAverageFromCenterWeight: 1.15,
    initialHighFromTargetWeight: 0.6,
    initialRootMismatchPenalty: 1.2,
    initialRootMatchReward: 1,
    lowMotionWeight: 0.85,
    highMotionWeight: 1,
    lowCommonToneReward: 1.5,
    highCommonToneReward: 2,
    sameDirectionPenalty: 1.4,
    sameDirectionLargePenalty: 2.2,
    averageShiftWeight: 0.75,
    rootMismatchPenalty: 0.4,
    missingRootOnChangePenalty: 0,
    rootInLowOnChangeReward: 0,
    definingToneOnChangeReward: 0,
    colorToneOnChangeReward: 0,
    ambiguousCarryoverPenalty: 0,
  },
  contour: {
    highSpanSoftLimit: 9,
    highReversalAfterNonStepPenalty: 2.2,
    highRepeatedReversalPenalty: 1.4,
    highUnrecoveredLeapPenalty: 3.4,
    highSpanExcessPenalty: 0.8,
    highCommonToneReward: 0.45,
    lowSpanSoftLimit: 12,
    lowReversalAfterNonStepPenalty: 0.9,
    lowRepeatedReversalPenalty: 0.55,
    lowUnrecoveredLeapPenalty: 1.6,
    lowSpanExcessPenalty: 0.25,
    lowCommonToneReward: 0.2,
    sameDirectionLargeMotionPenalty: 1.2,
    sameDirectionBothActivePenalty: 0.75,
  },
};

export const HARMONY_PRIORITY_PROFILES: Record<
  HarmonyPriority,
  HarmonyPriorityProfile
> = {
  voiceLeading: BASE_PROFILE,
  chordIntent: {
    candidate: {
      ...BASE_PROFILE.candidate,
      missingRootOnChangePenalty: 12,
      rootInLowOnChangeReward: 4.5,
      definingToneOnChangeReward: 1.6,
      colorToneOnChangeReward: 1.2,
      ambiguousCarryoverPenalty: 5.5,
    },
    contour: BASE_PROFILE.contour,
  },
};
