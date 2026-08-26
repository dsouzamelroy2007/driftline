"use client";

import { useEffect, useRef, useState } from "react";

export function QrCodeDisplay({ value, size = 220 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QRCode) =>
      QRCode.toDataURL(value, { width: size, margin: 1 }).then((url) => {
        if (!cancelled) setDataUrl(url);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div className="flex items-center justify-center text-text-muted" style={{ width: size, height: size }} role="status">
        Generating code…
      </div>
    );
  }

  // A data: URL — next/image can't optimize it anyway, so a plain <img> is the right tool here.
  return <img src={dataUrl} alt="Device linking QR code" width={size} height={size} className="rounded-control" />;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}

export interface QrCodeScannerProps {
  active: boolean;
  onScan: (value: string) => void;
}

// Tries the native BarcodeDetector API first (Chrome/Edge/Android); falls back to jsQR (pure-JS
// decode over a captured video frame) for browsers that don't implement it, e.g. Safari/Firefox
// (docs/ADR/0008-device-linking-protocol.md).
export function QrCodeScanner({ active, onScan }: QrCodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active) return undefined;

    let stream: MediaStream | null = null;
    let stopped = false;
    let frameHandle = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        setError("Couldn't access the camera — enter the code manually instead.");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike })
        .BarcodeDetector;
      const detector = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;

      async function tick() {
        if (stopped) return;
        if (!video || video.readyState < video.HAVE_CURRENT_DATA) {
          frameHandle = requestAnimationFrame(tick);
          return;
        }

        try {
          if (detector) {
            const results = await detector.detect(video);
            if (results[0]) {
              onScanRef.current(results[0].rawValue);
              return;
            }
          } else if (jsQR && canvas && ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(imageData.data, imageData.width, imageData.height);
            if (result) {
              onScanRef.current(result.data);
              return;
            }
          }
        } catch {
          // Transient decode errors on an out-of-focus/motion-blurred frame are expected — retry.
        }

        frameHandle = requestAnimationFrame(tick);
      }

      frameHandle = requestAnimationFrame(tick);
    }

    void start();

    return () => {
      stopped = true;
      cancelAnimationFrame(frameHandle);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [active]);

  if (error) {
    return <p className="text-sm text-status-error">{error}</p>;
  }

  return (
    <div className="overflow-hidden rounded-bubble border border-text-muted/20">
      <video ref={videoRef} muted playsInline className="w-full" />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
