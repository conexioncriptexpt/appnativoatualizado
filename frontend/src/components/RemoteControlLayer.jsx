import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";

const SPECIAL_KEYS = new Set([
  "Enter", "Backspace", "Escape", "Delete", "Home", "End", "PageUp", "PageDown",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
]);
const LONG_PRESS_MS = 650;
const MOVE_THRESHOLD = 0.015;

// Map a pointer position to 0..1 coordinates inside the object-contain media box.
function normalize(el, clientX, clientY) {
  const r = el.getBoundingClientRect();
  const vw = el.videoWidth || el.naturalWidth;
  const vh = el.videoHeight || el.naturalHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(r.width / vw, r.height / vh);
  const dw = vw * scale, dh = vh * scale;
  const nx = (clientX - r.left - (r.width - dw) / 2) / dw;
  const ny = (clientY - r.top - (r.height - dh) / 2) / dh;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return { nx: +nx.toFixed(4), ny: +ny.toFixed(4), px: clientX - r.left, py: clientY - r.top };
}

export function RemoteControlLayer({ getMedia, onCommand }) {
  const layerRef = useRef(null);
  const gesture = useRef(null);
  const textBuf = useRef({ text: "", timer: null });
  const wheel = useRef({ acc: 0, pos: null, timer: null });
  const [focused, setFocused] = useState(false);
  const [ripples, setRipples] = useState([]);
  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;
  const mediaRef = useRef(getMedia);
  mediaRef.current = getMedia;

  const point = (e) => {
    const m = getMedia();
    return m ? normalize(m, e.clientX, e.clientY) : null;
  };
  const ripple = (p, kind) => {
    const id = Math.random();
    setRipples((r) => [...r, { id, x: p.px, y: p.py, kind }]);
    setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 600);
  };
  const flushText = () => {
    clearTimeout(textBuf.current.timer);
    if (textBuf.current.text) onCommand({ type: "key", text: textBuf.current.text });
    textBuf.current.text = "";
  };

  const onPointerDown = (e) => {
    layerRef.current?.focus();
    const p = point(e);
    if (!p) return;
    if (e.button === 2) {
      ripple(p, "right");
      onCommand({ type: "rightclick", nx: p.nx, ny: p.ny });
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = { start: p, last: p, t: Date.now(), moved: false, done: false };
    g.timer = setTimeout(() => {
      if (!g.moved) {
        g.done = true;
        ripple(p, "long");
        onCommand({ type: "longpress", nx: p.nx, ny: p.ny });
      }
    }, LONG_PRESS_MS);
    gesture.current = g;
  };

  const onPointerMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    const p = point(e);
    if (!p) return;
    g.last = p;
    if (Math.hypot(p.nx - g.start.nx, p.ny - g.start.ny) > MOVE_THRESHOLD) {
      g.moved = true;
      clearTimeout(g.timer);
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.done) return;
    if (g.moved) {
      ripple(g.last, "drag");
      onCommand({
        type: "drag", nx: g.start.nx, ny: g.start.ny, nx2: g.last.nx, ny2: g.last.ny,
        duration: Math.min(1500, Math.max(150, Date.now() - g.t)),
      });
    } else {
      ripple(g.start, "click");
      onCommand({ type: "click", nx: g.start.nx, ny: g.start.ny });
    }
  };

  useEffect(() => {
    const el = layerRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      const m = mediaRef.current();
      const p = m ? normalize(m, e.clientX, e.clientY) : null;
      if (!p) return;
      const w = wheel.current;
      w.acc += e.deltaY;
      w.pos = p;
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        const notches = Math.max(1, Math.round(Math.abs(w.acc) / 100));
        cmdRef.current({ type: "scroll", nx: w.pos.nx, ny: w.pos.ny, delta: -Math.sign(w.acc) * notches * 120 });
        w.acc = 0;
      }, 120);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onKeyDown = (e) => {
    const mods = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
    if ((e.ctrlKey || e.altKey || e.metaKey) && e.key.length === 1) {
      e.preventDefault();
      flushText();
      onCommand({ type: "key", key: e.key.toLowerCase(), ...mods });
    } else if (e.key.length === 1) {
      e.preventDefault();
      textBuf.current.text += e.key;
      clearTimeout(textBuf.current.timer);
      textBuf.current.timer = setTimeout(flushText, 150);
    } else if (SPECIAL_KEYS.has(e.key)) {
      e.preventDefault();
      flushText();
      onCommand({ type: "key", key: e.key, ...mods });
    }
  };

  return (
    <div
      ref={layerRef}
      tabIndex={0}
      data-testid="remote-control-layer"
      className="absolute inset-0 z-10 cursor-crosshair outline-none touch-none select-none focus:ring-2 focus:ring-inset focus:ring-[#7FD113]/60"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { clearTimeout(gesture.current?.timer); gesture.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => { flushText(); setFocused(false); }}
    >
      {ripples.map((r) => (
        <span
          key={r.id}
          className={`remote-ripple remote-ripple-${r.kind}`}
          style={{ left: r.x, top: r.y }}
        />
      ))}
      <div
        className={`absolute bottom-2 left-2 text-[10px] font-mono px-2 py-1 rounded-md border flex items-center gap-1.5 transition-colors ${
          focused ? "bg-[#7FD113]/20 border-[#7FD113]/50 text-[#7FD113]" : "bg-black/60 border-[#2A2F38] text-gray-400"
        }`}
        data-testid="remote-control-hint"
      >
        <Keyboard size={12} />
        {focused ? "Controlo ativo · teclado ligado" : "Clique no ecrã para controlar"}
      </div>
    </div>
  );
}
