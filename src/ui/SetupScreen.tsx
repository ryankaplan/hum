import {
  Box,
  Flex,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useObservable } from "../observable";
import { acquirePermissionsAndStart } from "../recording/permissions";
import type { CustomArrangement } from "../music/arrangementScore";
import type { HarmonyRangeCoverage } from "../music/types";
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
  const [starting, setStarting] = useState(false);
  const [isCustomizingHarmony, setIsCustomizingHarmony] = useState(false);
  const [customArrangementDraft, setCustomArrangementDraft] =
    useState<CustomArrangement | null>(null);
  const [tempoInputValue, setTempoInputValue] = useState(
    String(arrangement.input.tempo),
  );
  const previewSessionRef = useRef<PlaybackSession | null>(null);

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
      stopAllPlayback();
      previewSessionRef.current?.stop();
      previewSessionRef.current = null;
      setPreviewingMode(null);
    }
  }, [arrangement.hasCustomHarmony, previewingMode]);

  useEffect(() => {
    if (appScreen === "setup") return;
    stopAllPlayback();
    previewSessionRef.current?.stop();
    previewSessionRef.current = null;
    setPreviewingMode(null);
  }, [appScreen]);

  useEffect(() => {
    return () => {
      stopAllPlayback();
      previewSessionRef.current?.stop();
      previewSessionRef.current = null;
    };
  }, []);

  async function handlePreview(mode: Exclude<PreviewMode, null>) {
    const parsed = arrangement.parsedChords;
    const voicing =
      mode === "custom"
        ? arrangement.effectiveHarmonyVoicing
        : arrangement.harmonyVoicing;
    const tempo = arrangement.input.tempo;

    if (voicing == null || parsed.length === 0) return;

    const ctx = await model.ensureAudioContext();
    if (ctx == null) return;

    stopAllPlayback();
    previewSessionRef.current?.stop();
    setPreviewingMode(mode);
    const session = playHarmonyPreview(
      ctx,
      parsed,
      arrangement.input.meter[0],
      tempo,
      mode === "custom" && arrangement.effectiveCustomArrangement != null
        ? { arrangementVoices: arrangement.effectiveCustomArrangement.voices }
        : { harmonyLines: voicing.lines },
    );
    previewSessionRef.current = session;

    const durationMs = progressionDurationSec(parsed, tempo) * 1000 + 400;
    setTimeout(() => {
      if (previewSessionRef.current === session) {
        session.stop();
        previewSessionRef.current = null;
        setPreviewingMode(null);
      }
    }, durationMs);
  }

  function handleStopPreview() {
    stopAllPlayback();
    previewSessionRef.current = null;
    setPreviewingMode(null);
  }

  function handleMeterLabelChange(label: string) {
    const found = METER_OPTIONS.find((o) => o.label === label);
    if (found != null) {
      model.setArrangementInput({ meter: found.value });
    }
  }

  function handlePartCountChange(value: "2" | "4") {
    model.setArrangementInput({ totalParts: value === "2" ? 2 : 4 });
  }

  function handleCustomizeHarmony() {
    const baseArrangement =
      arrangement.input.customArrangement ?? arrangement.effectiveCustomArrangement;
    if (baseArrangement == null) return;
    handleStopPreview();
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
    handleStopPreview();
    model.setArrangementInput({
      customArrangement: arrangementOverride,
    });
    setIsCustomizingHarmony(false);
  }

  function handleResetCustomHarmony() {
    if (previewingMode === "custom") {
      handleStopPreview();
    }
    model.setArrangementInput({ customArrangement: null });
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
    onPartCountChange: handlePartCountChange,
    onPreviewSelected: () => handlePreview("generated"),
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
