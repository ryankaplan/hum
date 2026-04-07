import { Box, Button, Flex, Input, Text } from "@chakra-ui/react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ArrangementMeasure } from "../state/model";
import { createShortUuid } from "../state/id";
import { dsColors, dsFocusRing } from "./designSystem";

type Props = {
  measures: ArrangementMeasure[];
  invalidChordIds: string[];
  onChange: (measures: ArrangementMeasure[]) => void;
};

type FocusTarget =
  | { type: "trailing" }
  | { type: "measure"; measureId: string };

export function ArrangementComposer({
  measures,
  invalidChordIds,
  onChange,
}: Props) {
  const [lyricsRequested, setLyricsRequested] = useState(false);
  const [draftChord, setDraftChord] = useState("");
  const [draftMode, setDraftMode] = useState<"new-measure" | "append-measure">(
    "new-measure",
  );
  const trailingInputRef = useRef<HTMLInputElement | null>(null);
  const chordInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const pendingFocusRef = useRef<FocusTarget | null>(null);

  const invalidChordIdSet = useMemo(
    () => new Set(invalidChordIds),
    [invalidChordIds],
  );
  const hasAnyLyrics = measures.some((measure) =>
    measure.chords.some((chord) => chord.lyrics.trim().length > 0),
  );
  const lyricsVisible = lyricsRequested || hasAnyLyrics;

  useEffect(() => {
    if (hasAnyLyrics) {
      setLyricsRequested(true);
    }
  }, [hasAnyLyrics]);

  useLayoutEffect(() => {
    const target = pendingFocusRef.current;
    if (target == null) return;
    pendingFocusRef.current = null;
    if (target.type === "trailing") {
      trailingInputRef.current?.focus();
      return;
    }
    chordInputRefs.current.get(getMeasureFocusKey(target.measureId))?.focus();
  }, [measures]);

  useEffect(() => {
    if (draftMode === "append-measure" && measures.length === 0) {
      setDraftMode("new-measure");
    }
  }, [draftMode, measures.length]);

  function focusMeasureByIndex(index: number) {
    if (index < 0) {
      trailingInputRef.current?.focus();
      return;
    }
    const measure = measures[index];
    if (measure == null) {
      trailingInputRef.current?.focus();
      return;
    }
    chordInputRefs.current.get(getMeasureFocusKey(measure.id))?.focus();
  }

  function updateChord(
    measureId: string,
    chordId: string,
    patch: Partial<{ chordText: string; lyrics: string }>,
  ) {
    onChange(
      measures.map((measure) =>
        measure.id !== measureId
          ? measure
          : {
              ...measure,
              chords: measure.chords.map((chord) =>
                chord.id !== chordId ? chord : { ...chord, ...patch },
              ),
            },
      ),
    );
  }

  function removeChord(measureId: string, chordId: string) {
    const measureIndex = measures.findIndex((measure) => measure.id === measureId);
    if (measureIndex < 0) return;

    const nextMeasures = measures
      .map((measure) =>
        measure.id !== measureId
          ? measure
          : {
              ...measure,
              chords: measure.chords.filter((chord) => chord.id !== chordId),
            },
      )
      .filter((measure) => measure.chords.length > 0);

    pendingFocusRef.current = { type: "trailing" };
    onChange(nextMeasures);
  }

  function commitDraft(nextMode: "new-measure" | "append-measure") {
    const trimmed = draftChord.trim();
    if (trimmed.length === 0) {
      setDraftMode(nextMode);
      return;
    }

    if (draftMode === "append-measure" && measures.length > 0) {
      const lastMeasure = measures[measures.length - 1]!;
      onChange(
        measures.map((measure) =>
          measure.id !== lastMeasure.id
            ? measure
            : {
                ...measure,
                chords: [
                  ...measure.chords,
                  {
                    id: createShortUuid(),
                    chordText: trimmed,
                    lyrics: "",
                  },
                ],
              },
        ),
      );
    } else {
      onChange([
        ...measures,
        {
          id: createShortUuid(),
          chords: [
            {
              id: createShortUuid(),
              chordText: trimmed,
              lyrics: "",
            },
          ],
        },
      ]);
    }

    setDraftChord("");
    setDraftMode(nextMode);
    pendingFocusRef.current = { type: "trailing" };
  }

  function handleTrailingKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      commitDraft("new-measure");
      return;
    }
    if (event.key === ",") {
      event.preventDefault();
      commitDraft("append-measure");
      return;
    }
    if (event.key === "ArrowLeft" && draftChord.length === 0) {
      event.preventDefault();
      focusMeasureByIndex(measures.length - 1);
      return;
    }
    if (event.key === "Tab" && event.shiftKey && draftChord.length === 0) {
      event.preventDefault();
      focusMeasureByIndex(measures.length - 1);
    }
  }

  function handleMeasureNavigation(
    event: KeyboardEvent<HTMLInputElement>,
    measureIndex: number,
  ) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusMeasureByIndex(measureIndex - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusMeasureByIndex(measureIndex + 1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      focusMeasureByIndex(measureIndex + (event.shiftKey ? -1 : 1));
    }
  }

  return (
    <Box>
      <Flex align="center" justify="space-between" gap={3} mb={3}>
        <Text color={dsColors.text} fontSize="sm" fontWeight="medium">
          Chord progression
        </Text>
        <Button
          variant="ghost"
          size="sm"
          px={3}
          color={lyricsVisible ? dsColors.accent : dsColors.textMuted}
          _hover={{ bg: dsColors.surfaceRaised, color: dsColors.text }}
          onClick={() => {
            if (lyricsVisible) {
              trailingInputRef.current?.focus();
              return;
            }
            setLyricsRequested(true);
          }}
        >
          {lyricsVisible ? "Edit lyrics" : "Add lyrics"}
        </Button>
      </Flex>

      <Box
        borderRadius="2xl"
        border="1px solid"
        borderColor={dsColors.border}
        bg={dsColors.surfaceSubtle}
        px={3}
        py={3}
        minH="120px"
      >
        <Flex wrap="wrap" gap={3} align="stretch">
          {measures.map((measure, measureIndex) => {
            const showLyrics = lyricsVisible;
            return (
              <Box
                key={measure.id}
                borderRadius="xl"
                border="1px solid"
                borderColor={dsColors.borderMuted}
                bg={dsColors.surfaceRaised}
                px={2.5}
                py={2}
                minW="94px"
                maxW="220px"
                display="flex"
                flexDirection="column"
                gap={showLyrics ? 2 : 0}
              >
                <Flex wrap="wrap" gap={2}>
                  {measure.chords.map((chord, chordIndex) => {
                    const isInvalid = invalidChordIdSet.has(chord.id);
                    return (
                      <Input
                        key={chord.id}
                        ref={(node) => {
                          if (chordIndex === 0) {
                            chordInputRefs.current.set(
                              getMeasureFocusKey(measure.id),
                              node,
                            );
                          }
                        }}
                        value={chord.chordText}
                        onChange={(e) =>
                          updateChord(measure.id, chord.id, {
                            chordText: e.target.value,
                          })
                        }
                        onKeyDown={(event) => {
                          handleMeasureNavigation(event, measureIndex);
                          if (
                            event.key === "Backspace" &&
                            chord.chordText.length === 0
                          ) {
                            event.preventDefault();
                            removeChord(measure.id, chord.id);
                          }
                        }}
                        size="sm"
                        variant="subtle"
                        width="auto"
                        minW={`${Math.max(42, chord.chordText.length * 11 + 26)}px`}
                        px={3}
                        borderRadius="full"
                        border="1px solid"
                        borderColor={isInvalid ? dsColors.errorBorder : "transparent"}
                        bg={isInvalid ? dsColors.errorBg : dsColors.surface}
                        color={dsColors.text}
                        fontWeight="semibold"
                        textAlign="center"
                        _focus={{
                          borderColor: isInvalid
                            ? dsColors.errorBorder
                            : dsColors.focusRing,
                          boxShadow: dsFocusRing,
                        }}
                      />
                    );
                  })}

                  {draftMode === "append-measure" &&
                    measureIndex === measures.length - 1 && (
                      <Input
                        ref={trailingInputRef}
                        value={draftChord}
                        onChange={(e) => setDraftChord(e.target.value)}
                        onKeyDown={handleTrailingKeyDown}
                        placeholder="Chord"
                        size="sm"
                        variant="subtle"
                        width="72px"
                        px={3}
                        borderRadius="full"
                        border="1px dashed"
                        borderColor={dsColors.border}
                        bg="transparent"
                        color={dsColors.text}
                        _focus={{
                          borderColor: dsColors.focusRing,
                          boxShadow: dsFocusRing,
                        }}
                      />
                    )}
                </Flex>

                {showLyrics && (
                  <Flex wrap="wrap" gap={2}>
                    {measure.chords.map((chord) => (
                      <Input
                        key={`${chord.id}-lyrics`}
                        value={chord.lyrics}
                        onChange={(e) =>
                          updateChord(measure.id, chord.id, {
                            lyrics: e.target.value,
                          })
                        }
                        placeholder="lyrics"
                        size="sm"
                        variant="subtle"
                        minW={`${Math.max(72, chord.chordText.length * 11 + 26)}px`}
                        px={3}
                        borderRadius="lg"
                        border="1px solid"
                        borderColor={dsColors.border}
                        bg={dsColors.surface}
                        color={dsColors.textMuted}
                        _focus={{
                          borderColor: dsColors.focusRing,
                          boxShadow: dsFocusRing,
                        }}
                      />
                    ))}
                  </Flex>
                )}
              </Box>
            );
          })}

          {draftMode === "new-measure" && (
            <Input
              ref={trailingInputRef}
              value={draftChord}
              onChange={(e) => setDraftChord(e.target.value)}
              onKeyDown={handleTrailingKeyDown}
              placeholder="Type chord"
              size="sm"
              variant="subtle"
              width="104px"
              alignSelf="flex-start"
              px={3}
              borderRadius="full"
              border="1px dashed"
              borderColor={dsColors.border}
              bg="transparent"
              color={dsColors.text}
              _focus={{
                borderColor: dsColors.focusRing,
                boxShadow: dsFocusRing,
              }}
            />
          )}
        </Flex>

        <Text color={dsColors.textSubtle} fontSize="xs" mt={3}>
          Press space for a new measure and comma to add another chord inside the
          current measure.
        </Text>
      </Box>
    </Box>
  );
}

function getMeasureFocusKey(measureId: string): string {
  return `measure:${measureId}`;
}
