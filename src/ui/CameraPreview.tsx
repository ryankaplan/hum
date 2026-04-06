import { Box } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { dsColors } from "./designSystem";

type Props = {
  stream: MediaStream;
  mirrored?: boolean;
  borderRadius?: string;
  // Cap height so the preview never overflows the viewport.
  // Defaults to 52vh which leaves room for controls below.
  maxH?: string;
};

export function CameraPreview({
  stream,
  mirrored = true,
  borderRadius = "xl",
  maxH = "52vh",
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video == null) return;
    video.srcObject = stream;
    video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    // Outer box constrains height; inner video cover-fits inside.
    <Box
      borderRadius={borderRadius}
      overflow="hidden"
      bg={dsColors.mediaBg}
      // Cap width so height never exceeds maxH at 9:16. Using w="100%" + maxH
      // alone breaks aspect-ratio in CSS because the browser won't shrink an
      // explicit width to satisfy max-height. min() keeps both constraints.
      w={`min(100%, calc(${maxH} * 9 / 16))`}
      aspectRatio="9/16"
      mx="auto"
      position="relative"
    >
      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: mirrored ? "scaleX(-1)" : "none",
          display: "block",
        }}
      />
    </Box>
  );
}
