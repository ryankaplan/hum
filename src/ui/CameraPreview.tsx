import { Box } from "@chakra-ui/react";
import { useEffect, useRef } from "react";

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
      bg="black"
      w="100%"
      // aspectRatio gives the natural 9:16 shape, maxH caps it on short screens
      aspectRatio="9/16"
      maxH={maxH}
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
