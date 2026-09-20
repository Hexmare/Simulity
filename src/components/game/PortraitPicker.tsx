import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Stock set under /portraits/ plus the player default. */
export const STOCK_PORTRAITS = [
  "/portraits/mara.jpg",
  "/portraits/nell.jpg",
  "/portraits/ivy.jpg",
  "/portraits/calder.jpg",
  "/portraits/bram.jpg",
  "/portraits/theo.jpg",
  "/portraits/player.jpg",
];

function isDataUrl(src?: string): boolean {
  return !!src && src.startsWith("data:image");
}

/**
 * Pick an existing portrait file, or upload + square-crop one.
 * Custom results are stored as a data-URL on the save. No CDN, no image API.
 */
export function PortraitPicker({ value, onChange }: { value?: string; onChange: (portrait: string | null) => void }) {
  const [upload, setUpload] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.4);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setMsg("That is not an image file.");
      return;
    }
    const url = URL.createObjectURL(f);
    setUpload(url);
    setZoom(1.4);
    setPos({ x: 50, y: 50 });
    setMsg(null);
  };

  const confirmCrop = () => {
    if (!upload) return;
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const crop = Math.max(32, side / zoom);
        const cx = (pos.x / 100) * img.naturalWidth;
        const cy = (pos.y / 100) * img.naturalHeight;
        const sx = Math.max(0, Math.min(img.naturalWidth - crop, cx - crop / 2));
        const sy = Math.max(0, Math.min(img.naturalHeight - crop, cy - crop / 2));
        const canvas = document.createElement("canvas");
        const out = 512;
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setMsg("Could not crop that image.");
          return;
        }
        ctx.drawImage(img, sx, sy, crop, crop, 0, 0, out, out);
        const data = canvas.toDataURL("image/jpeg", 0.85);
        URL.revokeObjectURL(upload);
        setUpload(null);
        onChange(data);
      } catch {
        setMsg("Could not crop that image.");
      }
    };
    img.onerror = () => setMsg("Could not read that image.");
    img.src = upload;
  };

  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Portrait</p>
      <div className="flex items-center gap-3">
        {value ? (
          <img src={value} alt="" className="portrait size-16 rounded-full object-cover" crossOrigin="anonymous" />
        ) : (
          <div className="size-16 rounded-full bg-card-2" />
        )}
        <div className="flex flex-wrap gap-1">
          {isDataUrl(value) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              Clear custom
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            Upload
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {STOCK_PORTRAITS.map((src) => (
          <button
            key={src}
            type="button"
            onClick={() => onChange(src)}
            className={cn("overflow-hidden rounded-sm", value === src ? "outline-2 outline-accent" : "opacity-80 hover:opacity-100")}
            title={src}
          >
            <img src={src} alt="" className="aspect-square w-full object-cover" crossOrigin="anonymous" />
          </button>
        ))}
      </div>
      {upload && (
        <div className="grid gap-2 rounded-sm bg-card-2 p-3">
          <div
            className="relative mx-auto aspect-square w-48 cursor-move touch-none overflow-hidden rounded-sm bg-background"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              setDrag({ x: e.clientX, y: e.clientY });
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const el = e.currentTarget as HTMLElement;
              const rect = el.getBoundingClientRect();
              setPos((p) => ({
                x: Math.max(0, Math.min(100, p.x - ((e.clientX - drag.x) / rect.width) * 100)),
                y: Math.max(0, Math.min(100, p.y - ((e.clientY - drag.y) / rect.height) * 100)),
              }));
              setDrag({ x: e.clientX, y: e.clientY });
            }}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
          >
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url(${upload})`,
                backgroundSize: `${zoom * 100}%`,
                backgroundPosition: `${pos.x}% ${pos.y}%`,
                backgroundRepeat: "no-repeat",
              }}
            />
          </div>
          <label className="grid gap-1 text-xs text-muted">
            Zoom
            <input type="range" min={1} max={4} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={confirmCrop}>
              Use this crop
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                URL.revokeObjectURL(upload);
                setUpload(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-danger">{msg}</p>}
    </div>
  );
}
