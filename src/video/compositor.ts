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

const CANVAS_WIDTH = 540;
const CANVAS_HEIGHT = 960;

export function startCompositor(
  canvas: HTMLCanvasElement,
  videos: HTMLVideoElement[],
  opts?: CompositorOpts,
): CompositorHandle {
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;

  const ctx2d = canvas.getContext("2d");
  if (ctx2d == null) throw new Error("Could not get canvas 2D context");
  const ctx = ctx2d;

  const cellW = CANVAS_WIDTH / 2;
  const cellH = CANVAS_HEIGHT / 2;

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
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (let i = 0; i < 4; i++) {
      const video = videos[i];
      const pos = positions[i]!;
      const active = opts?.isVideoActive?.(i) ?? true;
      const cache = frameCache[i];

      if (video != null && active && video.readyState >= 2) {
        // Cover-fit: center-crop the video into the cell.
        drawCoverFit(ctx, video, pos[0], pos[1], cellW, cellH);
        if (cache?.ctx != null) {
          drawCoverFit(cache.ctx, video, 0, 0, cellW, cellH);
          cache.hasFrame = true;
        }
      } else if (cache?.hasFrame) {
        ctx.drawImage(cache.canvas, pos[0], pos[1], cellW, cellH);
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(pos[0], pos[1], cellW, cellH);
      }
    }

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

function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const vw = video.videoWidth || w;
  const vh = video.videoHeight || h;
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
