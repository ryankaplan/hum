// Draws 4 video elements into a 2x2 grid on a canvas at 9:16 aspect ratio.

export type CompositorHandle = {
  stop: () => void;
};

const CANVAS_WIDTH = 540;
const CANVAS_HEIGHT = 960;

export function startCompositor(
  canvas: HTMLCanvasElement,
  videos: HTMLVideoElement[],
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

  let rafId: number;

  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (let i = 0; i < videos.length && i < 4; i++) {
      const video = videos[i]!;
      const pos = positions[i]!;
      if (video.readyState >= 2) {
        // Cover-fit: center-crop the video into the cell
        drawCoverFit(ctx, video, pos[0], pos[1], cellW, cellH);
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(pos[0], pos[1], cellW, cellH);
      }
    }

    rafId = requestAnimationFrame(draw);
  }

  draw();

  return {
    stop() {
      cancelAnimationFrame(rafId);
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
