import React, { useRef, useEffect } from 'react';

interface WaveformDisplayProps {
  peaks: number[];
  peaksR?: number[] | null;
  color: string;
  height?: number;
  isPlaying?: boolean;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
};

// Draw a single channel waveform within a vertical slice [yTop, yBottom] of the canvas.
// Mirror: if true, waveform grows downward from yTop (right channel style).
function drawChannel(
  ctx: CanvasRenderingContext2D,
  peaks: number[],
  W: number,
  yTop: number,
  yBottom: number,
  r: number,
  g: number,
  b: number,
  flip = false,
) {
  const c = (a: number) => `rgba(${r},${g},${b},${a})`;
  const height = yBottom - yTop;
  const mid    = yTop + height / 2;
  const n      = peaks.length;

  const topPts: [number, number][] = peaks.map((p, i) => [
    (i / (n - 1)) * W,
    mid - Math.max(0, p) * (height / 2 - 1) * (flip ? -0.92 : 0.92),
  ]);
  const botPts: [number, number][] = peaks.map((p, i) => [
    (i / (n - 1)) * W,
    mid + Math.max(0, p) * (height / 2 - 1) * (flip ? -0.92 : 0.92),
  ]);

  // Fill top half
  const gradTop = ctx.createLinearGradient(0, yTop, 0, mid);
  gradTop.addColorStop(0,   c(0.55));
  gradTop.addColorStop(0.6, c(0.22));
  gradTop.addColorStop(1,   c(0.06));
  ctx.beginPath();
  ctx.moveTo(0, mid);
  for (const [x, y] of topPts) ctx.lineTo(x, y);
  ctx.lineTo(W, mid);
  ctx.closePath();
  ctx.fillStyle = gradTop;
  ctx.fill();

  // Fill bottom half
  const gradBot = ctx.createLinearGradient(0, mid, 0, yBottom);
  gradBot.addColorStop(0,   c(0.06));
  gradBot.addColorStop(0.4, c(0.22));
  gradBot.addColorStop(1,   c(0.55));
  ctx.beginPath();
  ctx.moveTo(0, mid);
  for (const [x, y] of botPts) ctx.lineTo(x, y);
  ctx.lineTo(W, mid);
  ctx.closePath();
  ctx.fillStyle = gradBot;
  ctx.fill();

  // Top outline
  ctx.beginPath();
  topPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.strokeStyle = c(0.9);
  ctx.lineWidth   = 1;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // Bottom outline
  ctx.beginPath();
  botPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.strokeStyle = c(0.9);
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Zero-line (centre hairline) — visible reference mark
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(W, mid);
  ctx.strokeStyle = c(0.35);
  ctx.lineWidth   = 0.75;
  ctx.setLineDash([2, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  peaksR: number[] | null | undefined,
  color: string,
) {
  const dpr  = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0 || peaks.length === 0) return;

  const needW = Math.round(cssW * dpr);
  const needH = Math.round(cssH * dpr);
  if (canvas.width !== needW || canvas.height !== needH) {
    canvas.width  = needW;
    canvas.height = needH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = cssW;
  const H = cssH;
  ctx.clearRect(0, 0, W, H);

  const [r, g, b] = hexToRgb(color);

  if (peaksR && peaksR.length > 0) {
    // Stereo: left channel in top half, right channel in bottom half
    // Thin divider line between them
    const half = H / 2;
    drawChannel(ctx, peaks,  W, 0,    half, r, g, b);
    drawChannel(ctx, peaksR, W, half, H,    r, g, b);
    // Separator line
    ctx.beginPath();
    ctx.moveTo(0, half);
    ctx.lineTo(W, half);
    ctx.strokeStyle = `rgba(0,0,0,0.5)`;
    ctx.lineWidth   = 1;
    ctx.stroke();
  } else {
    // Mono: single waveform filling the full height
    drawChannel(ctx, peaks, W, 0, H, r, g, b);
  }
}

const WaveformDisplay: React.FC<WaveformDisplayProps> = ({
  peaks,
  peaksR,
  color,
  height,
  isPlaying = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const render = () => drawWaveform(canvas, peaks, peaksR, color);

    const ro = new ResizeObserver(render);
    ro.observe(canvas);
    render();

    return () => ro.disconnect();
  }, [peaks, peaksR, color]);

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: height != null ? `${height}px` : '100%',
  };

  return (
    <div style={containerStyle}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {isPlaying && <div className="waveform-scan" />}
    </div>
  );
};

export default WaveformDisplay;
