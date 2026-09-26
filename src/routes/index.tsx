import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { describeScene } from "@/lib/describe.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WeSee — Point, tap, hear what is in front of you" },
      {
        name: "description",
        content:
          "WeSee is an AI vision assistant for people with low vision. Tap anywhere to scan and hear a short spoken description of the scene.",
      },
      { property: "og:title", content: "WeSee — Point, tap, hear what is in front of you" },
      {
        property: "og:description",
        content:
          "An AI vision assistant for low vision. Tap the screen, hear hazards and surroundings described out loud.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#000000" },
    ],
    links: [{ rel: "manifest", href: "/manifest.webmanifest" }],
  }),
  component: WeSee,
});

const PRIVACY_TEXT =
  "WeSee sends your camera photos to an AI service to describe them. Photos are not stored. WeSee is an assistive aid, not a safety device. It can be wrong.";

type Status = "idle" | "starting" | "ready" | "scanning" | "error";

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-IN";
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

function buzz(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* unsupported */
    }
  }
}

function WeSee() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanningRef = useRef(false);

  const [status, setStatus] = useState<Status>("idle");
  const [statusText, setStatusText] = useState("Starting camera…");
  const [caption, setCaption] = useState("");
  const [lastResult, setLastResult] = useState("");
  const [showNotice, setShowNotice] = useState(false);

  const describe = useServerFn(describeScene);

  useEffect(() => {
    const seen =
      typeof window !== "undefined" && window.localStorage.getItem("wesee.notice") === "1";
    if (!seen) setShowNotice(true);
  }, []);

  const startCamera = useCallback(async () => {
    setStatus("starting");
    setStatusText("Starting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("ready");
      setStatusText("Ready");
      setCaption("Tap anywhere to scan.");
      speak("WeSee is ready. Tap anywhere to scan.");
    } catch {
      setStatus("error");
      setStatusText("No camera");
      const msg =
        "I cannot reach the camera. Allow camera access in your browser settings, then tap to try again.";
      setCaption(msg);
      speak(msg);
    }
  }, []);

  useEffect(() => {
    if (!showNotice) void startCamera();
  }, [showNotice, startCamera]);

  const acceptNotice = () => {
    window.localStorage.setItem("wesee.notice", "1");
    setShowNotice(false);
  };

  useEffect(() => {
    if (showNotice) speak(PRIVACY_TEXT);
  }, [showNotice]);

  const scan = useCallback(async () => {
    if (scanningRef.current) return;
    if (status === "error" || status === "idle") {
      void startCamera();
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    scanningRef.current = true;
    setStatus("scanning");
    setStatusText("Scanning…");
    setCaption("");
    speak("Scanning");
    buzz(60);

    try {
      const scale = 768 / Math.max(video.videoWidth, video.videoHeight);
      const w = Math.round(video.videoWidth * Math.min(1, scale));
      const h = Math.round(video.videoHeight * Math.min(1, scale));
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.7);

      const result = await describe({ data: { imageBase64 } });

      if (result.success) {
        setStatus("ready");
        setStatusText("Result");
        setCaption(result.description);
        setLastResult(result.description);
        speak(result.description);
        buzz([40, 80, 40]);
      } else {
        setStatus("ready");
        setStatusText("Failed");
        setCaption(result.error);
        speak(result.error);
        buzz(300);
      }
    } catch {
      const msg = "I could not scan that. Check your connection and tap to try again.";
      setStatus("ready");
      setStatusText("Failed");
      setCaption(msg);
      speak(msg);
      buzz(300);
    } finally {
      scanningRef.current = false;
    }
  }, [describe, startCamera, status]);

  const repeat = useCallback(() => {
    if (scanningRef.current) return;
    speak(lastResult || "There is no result yet. Tap once to scan.");
  }, [lastResult]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-scene">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {!showNotice && (
        <button
          type="button"
          onClick={() => void scan()}
          onDoubleClick={repeat}
          onContextMenu={(e) => {
            e.preventDefault();
            repeat();
          }}
          aria-label="Scan what is in front of the camera"
          className="absolute inset-0 z-10 h-full w-full bg-transparent"
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 border-t-4 border-accent bg-panel px-5 pb-10 pt-6">
        <p className="text-status font-extrabold text-accent">{statusText}</p>
        <p
          role="status"
          aria-live="polite"
          className="mt-3 min-h-[68px] text-caption font-medium text-scene-foreground"
        >
          {caption}
        </p>
        <p className="mt-3 text-hint text-muted-strong">
          Tap anywhere to scan. Double tap or long press to repeat. Assistive aid only — it can be
          wrong.
        </p>
      </div>

      {showNotice && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end bg-scene px-5 pb-12 pt-10">
          <h1 className="text-status font-extrabold text-accent">WeSee</h1>
          <p className="mt-4 text-caption font-medium text-scene-foreground">{PRIVACY_TEXT}</p>
          <p className="mt-3 text-hint text-muted-strong">
            On iPhone there is no vibration, and you add WeSee to your home screen with Share, then
            Add to Home Screen.
          </p>
          <button
            type="button"
            onClick={acceptNotice}
            className="mt-8 w-full rounded-xl bg-accent px-6 py-6 text-status font-extrabold text-scene"
          >
            Start
          </button>
        </div>
      )}
    </div>
  );
}
