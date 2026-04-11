// Draws up to 4 video elements into a 2x2 grid on a canvas at 9:16 aspect
// ratio.

export type CompositorHandle = {
  drawFrame: () => void;
  setAutoRender: (enabled: boolean) => void;
  stop: () => void;
};

export type CompositorOpts = {
  isVideoActive?: (index: number) => boolean;
};

export const COMPOSITOR_CANVAS_WIDTH = 540;
export const COMPOSITOR_CANVAS_HEIGHT = 960;

export function startCompositor(
  canvas: HTMLCanvasElement,
  videos: HTMLVideoElement[],
  opts?: CompositorOpts,
): CompositorHandle {
  canvas.width = COMPOSITOR_CANVAS_WIDTH;
  canvas.height = COMPOSITOR_CANVAS_HEIGHT;

  const ctx2d = canvas.getContext("2d");
  if (ctx2d == null) throw new Error("Could not get canvas 2D context");
  const ctx = ctx2d;

  const cellW = COMPOSITOR_CANVAS_WIDTH / 2;
  const cellH = COMPOSITOR_CANVAS_HEIGHT / 2;

  const positions: [number, number][] = [
    [0, 0],
    [cellW, 0],
    [0, cellH],
    [cellW, cellH],
  ];

  const frameCache = Array.from({ length: 4 }, () => {
    const canvasEl = document.createElement("canvas");
    canvasEl.width = cellW;
    canvasEl.height = cellH;
    return {
      canvas: canvasEl,
      ctx: canvasEl.getContext("2d"),
      hasFrame: false,
    };
  });

  let rafId: number | null = null;
  let autoRenderEnabled = true;

  function renderFrame() {
    drawCompositeGridFrame({
      ctx,
      sources: videos,
      isSourceActive: (index) => opts?.isVideoActive?.(index) ?? true,
      getCachedFrame: (index) => frameCache[index] ?? null,
      cellWidth: cellW,
      cellHeight: cellH,
      positions,
    });
  }

  function scheduleNextFrame(): void {
    if (!autoRenderEnabled || rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      renderFrame();
      scheduleNextFrame();
    });
  }

  scheduleNextFrame();

  return {
    drawFrame() {
      renderFrame();
    },
    setAutoRender(enabled) {
      autoRenderEnabled = enabled;
      if (!enabled && rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        return;
      }
      if (enabled) {
        renderFrame();
        scheduleNextFrame();
      }
    },
    stop() {
      autoRenderEnabled = false;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}

type CachedFrame = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  hasFrame: boolean;
};

type DrawCompositeGridFrameInput = {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  sources: Array<CanvasImageSource | null | undefined>;
  isSourceActive?: (index: number) => boolean;
  getCachedFrame?: (index: number) => CachedFrame | null;
  cellWidth?: number;
  cellHeight?: number;
  positions?: [number, number][];
};

export function drawCompositeGridFrame({
  ctx,
  sources,
  isSourceActive,
  getCachedFrame,
  cellWidth = COMPOSITOR_CANVAS_WIDTH / 2,
  cellHeight = COMPOSITOR_CANVAS_HEIGHT / 2,
  positions = [
    [0, 0],
    [cellWidth, 0],
    [0, cellHeight],
    [cellWidth, cellHeight],
  ],
}: DrawCompositeGridFrameInput): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, COMPOSITOR_CANVAS_WIDTH, COMPOSITOR_CANVAS_HEIGHT);

  for (let i = 0; i < 4; i++) {
    const source = sources[i];
    const [x, y] = positions[i] ?? [0, 0];
    const active = isSourceActive?.(i) ?? true;
    const cache = getCachedFrame?.(i) ?? null;

    if (source != null && active && isCanvasSourceReady(source)) {
      drawCoverFit(ctx, source, x, y, cellWidth, cellHeight);
      if (cache?.ctx != null) {
        drawCoverFit(cache.ctx, source, 0, 0, cellWidth, cellHeight);
        cache.hasFrame = true;
      }
    } else if (cache?.hasFrame) {
      ctx.drawImage(cache.canvas, x, y, cellWidth, cellHeight);
    } else {
      ctx.fillStyle = "#111";
      ctx.fillRect(x, y, cellWidth, cellHeight);
    }
  }
}

function drawCoverFit(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  video: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const { width: vw, height: vh } = getSourceDimensions(video, w, h);
  const vAspect = vw / vh;
  const cAspect = w / h;

  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (vAspect > cAspect) {
    // Video is wider — crop sides
    sw = vh * cAspect;
    sx = (vw - sw) / 2;
  } else {
    // Video is taller — crop top/bottom
    sh = vw / cAspect;
    sy = (vh - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, x, y, w, h);
}

function getSourceDimensions(
  source: CanvasImageSource,
  fallbackWidth: number,
  fallbackHeight: number,
): { width: number; height: number } {
  if ("videoWidth" in source && "videoHeight" in source) {
    return {
      width: source.videoWidth || fallbackWidth,
      height: source.videoHeight || fallbackHeight,
    };
  }
  if ("naturalWidth" in source && "naturalHeight" in source) {
    return {
      width: source.naturalWidth || fallbackWidth,
      height: source.naturalHeight || fallbackHeight,
    };
  }
  if ("width" in source && "height" in source) {
    return {
      width: Number(source.width) || fallbackWidth,
      height: Number(source.height) || fallbackHeight,
    };
  }
  return { width: fallbackWidth, height: fallbackHeight };
}

function isCanvasSourceReady(source: CanvasImageSource): boolean {
  if ("readyState" in source) {
    return source.readyState >= 2;
  }
  const { width, height } = getSourceDimensions(source, 0, 0);
  return width > 0 && height > 0;
}
