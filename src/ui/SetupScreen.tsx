import {
  Box,
  Flex,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useObservable } from "../observable";
import { acquirePermissionsAndStart } from "../recording/permissions";
import type { CustomArrangement } from "../music/arrangementScore";
import {
  DEFAULT_HARMONY_RHYTHM_PATTERN_ID,
  getAvailableHarmonyRhythmPatterns,
  getHarmonyRhythmPattern,
  getHarmonyRhythmPreviewHits,
  getHarmonyRhythmPreviewSteps,
  type HarmonyRhythmPatternId,
} from "../music/harmonyRhythmPatterns";
import type { HarmonyPriority, HarmonyRangeCoverage } from "../music/types";
import { playClick, playGuideTone } from "../audio/synths";
import {
  playHarmonyPreview,
  progressionDurationSec,
  stopAllPlayback,
} from "../music/playback";
import type { PlaybackSession } from "../music/playback";
import { model } from "../state/model";
import { dsScreenShell } from "./designSystem";
import { CustomHarmonyEditor } from "./CustomHarmonyEditor";
import { SetupCard } from "./setupScreen/SetupCard";
import { METER_OPTIONS, RANGE_OPTIONS, type PreviewMode } from "./setupScreen/types";

export function SetupScreen() {
  const arrangement = useObservable(model.derivedArrangementInfo);
  const audioContext = useObservable(model.audioContext);
  const error = useObservable(model.permissionError);
  const appScreen = useObservable(model.appScreen);

  const [previewingMode, setPreviewingMode] = useState<PreviewMode>(null);
  const [previewingPatternId, setPreviewingPatternId] =
    useState<HarmonyRhythmPatternId | null>(null);
  const [previewingPatternStepIndex, setPreviewingPatternStepIndex] =
    useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [isCustomizingHarmony, setIsCustomizingHarmony] = useState(false);
  const [customArrangementDraft, setCustomArrangementDraft] =
    useState<CustomArrangement | null>(null);
  const [tempoInputValue, setTempoInputValue] = useState(
    String(arrangement.input.tempo),
  );
  const previewSessionRef = useRef<PlaybackSession | null>(null);
  const patternPreviewTimeoutRef = useRef<number | null>(null);
  const patternPreviewStepTimeoutIdsRef = useRef<number[]>([]);
  const previewRequestIdRef = useRef(0);

  const meter = arrangement.input.meter;
  const meterLabel =
    METER_OPTIONS.find(
      (o) => o.value[0] === meter[0] && o.value[1] === meter[1],
    )?.label ?? "4/4";

  useEffect(() => {
    setTempoInputValue(String(arrangement.input.tempo));
  }, [arrangement.input.tempo]);

  useEffect(() => {
    if (previewingMode === "custom" && !arrangement.hasCustomHarmony) {
      stopAllPreviews();
    }
  }, [arrangement.hasCustomHarmony, previewingMode]);

  useEffect(() => {
    const availablePatterns = getAvailableHarmonyRhythmPatterns(
      arrangement.input.meter,
    );
    if (
      availablePatterns.some(
        (pattern) => pattern.id === arrangement.input.harmonyRhythmPatternId,
      )
    ) {
      return;
    }
    model.setArrangementInput({
      harmonyRhythmPatternId: DEFAULT_HARMONY_RHYTHM_PATTERN_ID,
    });
  }, [arrangement.input.harmonyRhythmPatternId, arrangement.input.meter]);

  useEffect(() => {
    if (appScreen === "setup") return;
    stopAllPreviews();
  }, [appScreen]);

  useEffect(() => {
    return () => {
      stopAllPreviews();
    };
  }, []);

  async function handlePreview(mode: Exclude<PreviewMode, null>) {
    const requestId = beginPreviewRequest();
    const parsed = arrangement.parsedChords;
    const arrangementVoices =
      mode === "custom"
        ? arrangement.effectiveCustomArrangement?.voices
        : arrangement.generatedArrangement?.voices;
    const tempo = arrangement.input.tempo;

    if (parsed.length === 0 || arrangementVoices == null) {
      return;
    }

    const ctx = await model.ensureAudioContext();
    if (ctx == null || previewRequestIdRef.current !== requestId) return;

    setPreviewingMode(mode);
    const session = playHarmonyPreview(
      ctx,
      parsed,
      arrangement.input.meter[0],
      tempo,
      { arrangementVoices },
    );
    previewSessionRef.current = session;

    const durationMs = progressionDurationSec(parsed, tempo) * 1000 + 400;
    setTimeout(() => {
      if (
        previewRequestIdRef.current === requestId &&
        previewSessionRef.current === session
      ) {
        stopAllPreviews();
      }
    }, durationMs);
  }

  function handleStopPreview() {
    stopAllPreviews();
  }

  function handleMeterLabelChange(label: string) {
    const found = METER_OPTIONS.find((o) => o.label === label);
    if (found != null) {
      model.setArrangementInput({ meter: found.value });
    }
  }

  function handlePartCountChange(value: "3" | "4") {
    model.setArrangementInput({ totalParts: value === "3" ? 3 : 4 });
  }

  function handleHarmonyRhythmPatternChange(value: HarmonyRhythmPatternId) {
    if (value === arrangement.input.harmonyRhythmPatternId) return;

    if (arrangement.hasCustomHarmony) {
      const nextPattern = getHarmonyRhythmPattern(value);
      const confirmed = window.confirm(
        `Switch to ${nextPattern.name}? This will replace your custom harmony rhythm edits.`,
      );
      if (!confirmed) return;
      stopAllPreviews();
      model.setArrangementInput({
        harmonyRhythmPatternId: value,
        customArrangement: null,
      });
      return;
    }

    model.setArrangementInput({ harmonyRhythmPatternId: value });
  }

  function handleCustomizeHarmony() {
    const baseArrangement =
      arrangement.input.customArrangement ?? arrangement.effectiveCustomArrangement;
    if (baseArrangement == null) return;
    stopAllPreviews();
    setCustomArrangementDraft({
      voices: baseArrangement.voices.map((voice: CustomArrangement["voices"][number]) => ({
        id: voice.id,
        events: voice.events.map(
          (
            event: CustomArrangement["voices"][number]["events"][number],
          ) => ({ ...event }),
        ),
      })),
    });
    setIsCustomizingHarmony(true);
  }

  function handleSaveCustomHarmony(arrangementOverride: CustomArrangement) {
    stopAllPreviews();
    model.setArrangementInput({
      customArrangement: arrangementOverride,
    });
    setIsCustomizingHarmony(false);
  }

  function handleResetCustomHarmony() {
    if (previewingMode === "custom") {
      stopAllPreviews();
    }
    model.setArrangementInput({ customArrangement: null });
  }

  async function handlePatternPreviewToggle(patternId: HarmonyRhythmPatternId) {
    if (previewingPatternId === patternId) {
      stopAllPreviews();
      return;
    }

    const requestId = beginPreviewRequest();

    const ctx = await model.ensureAudioContext();
    if (ctx == null || previewRequestIdRef.current !== requestId) return;

    setPreviewingPatternId(patternId);
    setPreviewingPatternStepIndex(0);

    const startTime = ctx.currentTime + 0.05;
    const secPerBeat = 60 / arrangement.input.tempo;
    const beatsPerBar = Math.max(1, arrangement.input.meter[0]);
    const previewMeasureCount = 2;
    const totalBeats = beatsPerBar * previewMeasureCount;
    const previewSteps = getHarmonyRhythmPreviewSteps(
      getHarmonyRhythmPattern(patternId),
      arrangement.input.meter,
    );
    const stepBeats = previewSteps.length > 0 ? beatsPerBar / previewSteps.length : 1;
    const hits = getHarmonyRhythmPreviewHits(
      patternId,
      arrangement.input.meter,
      previewMeasureCount,
    );

    for (let beatIndex = 0; beatIndex < totalBeats; beatIndex++) {
      playClick(
        ctx,
        startTime + beatIndex * secPerBeat,
        beatIndex % beatsPerBar === 0,
        beatIndex % beatsPerBar === 0 ? 0.28 : 0.18,
      );
    }

    for (const hit of hits) {
      const isBarStart = Math.abs(hit.startBeat % beatsPerBar) < 0.001;
      playGuideTone(
        ctx,
        hit.isDownbeat ? 880 : 660,
        startTime + hit.startBeat * secPerBeat,
        isBarStart ? 0.26 : 0.18,
        hit.isDownbeat ? 0.9 : 0.75,
      );
    }

    const totalSteps = previewSteps.length * previewMeasureCount;
    for (let stepIndex = 0; stepIndex < totalSteps; stepIndex++) {
      const timeoutId = window.setTimeout(() => {
        if (previewRequestIdRef.current !== requestId) return;
        setPreviewingPatternStepIndex(stepIndex % previewSteps.length);
      }, stepIndex * stepBeats * secPerBeat * 1000);
      patternPreviewStepTimeoutIdsRef.current.push(timeoutId);
    }

    patternPreviewTimeoutRef.current = window.setTimeout(() => {
      if (previewRequestIdRef.current !== requestId) return;
      stopAllPreviews();
    }, totalBeats * secPerBeat * 1000 + 120);
  }

  function stopAllPreviews() {
    previewRequestIdRef.current += 1;
    stopAllPlayback();
    previewSessionRef.current?.stop();
    previewSessionRef.current = null;
    if (patternPreviewTimeoutRef.current != null) {
      window.clearTimeout(patternPreviewTimeoutRef.current);
      patternPreviewTimeoutRef.current = null;
    }
    for (const timeoutId of patternPreviewStepTimeoutIdsRef.current) {
      window.clearTimeout(timeoutId);
    }
    patternPreviewStepTimeoutIdsRef.current = [];
    setPreviewingMode(null);
    setPreviewingPatternId(null);
    setPreviewingPatternStepIndex(null);
  }

  function beginPreviewRequest(): number {
    stopAllPreviews();
    return previewRequestIdRef.current;
  }

  function handleTempoInputChange(value: string) {
    setTempoInputValue(value);
    if (value.trim() === "") return;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    model.setArrangementInput({ tempo: parsed });
  }

  function handleTempoInputBlur() {
    const raw = tempoInputValue.trim();
    if (raw === "") {
      setTempoInputValue(String(arrangement.input.tempo));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      setTempoInputValue(String(arrangement.input.tempo));
      return;
    }
    const clamped = Math.min(240, Math.max(40, parsed));
    if (clamped !== arrangement.input.tempo) {
      model.setArrangementInput({ tempo: clamped });
    }
    setTempoInputValue(String(clamped));
  }

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    try {
      model.clearRecordingTarget();
      await acquirePermissionsAndStart();
    } finally {
      setStarting(false);
    }
  }

  const sharedCardProps = {
    arrangement,
    meterLabel,
    tempoInputValue,
    previewingMode,
    starting,
    error,
    onChordsChange: (value: string) =>
      model.setArrangementInput({ chordsInput: value }),
    onTempoInputChange: handleTempoInputChange,
    onTempoInputBlur: handleTempoInputBlur,
    onMeterLabelChange: handleMeterLabelChange,
    onRangePresetChange: (value: string) => {
      const range = RANGE_OPTIONS.find((option) => option.label === value);
      if (range == null) return;
      model.setArrangementInput({
        vocalRangeLow: range.low,
        vocalRangeHigh: range.high,
      });
    },
    onHarmonyCoverageChange: (value: HarmonyRangeCoverage) => {
      model.setArrangementInput({
        harmonyRangeCoverage: value,
      });
    },
    onHarmonyPriorityChange: (value: HarmonyPriority) => {
      model.setArrangementInput({
        harmonyPriority: value,
      });
    },
    onPartCountChange: handlePartCountChange,
    onHarmonyRhythmPatternChange: handleHarmonyRhythmPatternChange,
    previewingPatternId,
    previewingPatternStepIndex,
    onPatternPreviewToggle: handlePatternPreviewToggle,
    onPreviewPattern: () => handlePreview("pattern"),
    onPreviewCustom: () => handlePreview("custom"),
    onStopPreview: handleStopPreview,
    onCustomizeHarmony: handleCustomizeHarmony,
    onResetCustomHarmony: handleResetCustomHarmony,
    onStart: handleStart,
  };

  if (isCustomizingHarmony) {
    return (
      <CustomHarmonyEditor
        arrangement={arrangement}
        draftArrangement={customArrangementDraft ?? arrangement.effectiveCustomArrangement}
        ctx={audioContext}
        onRequestAudioContext={() => model.ensureAudioContext()}
        onCancel={() => setIsCustomizingHarmony(false)}
        onSave={handleSaveCustomHarmony}
      />
    );
  }

  return (
    <Flex {...dsScreenShell} py={8}>
      <Box w="100%" maxW="560px">
        <SetupCard {...sharedCardProps} />
      </Box>
    </Flex>
  );
}
