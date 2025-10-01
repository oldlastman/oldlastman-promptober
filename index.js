import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Promptober Pop‑Cine – Single-file React component (sin dependencias externas de UI)
 * Stack: React + Tailwind
 * Persistencia: IndexedDB
 * Mes fijo: Octubre (31 días)
 * Funciones: exportar/importar JSON, oEmbed + intento de scrape (proxy r.jina.ai) para imágenes de X,
 *            galería con lightbox (zoom/pan/carrusel), calendario con estado y tooltip de prompt.
 *
 * FIXES:
 *  - RegExp de división corregida en handleManualUrlsSave (/[,\n]/).
 *  - Extracción de imágenes desde el HTML de oEmbed sin depender del estado asíncrono.
 *  - **Eliminada la segunda declaración de `dragRef`** que provocaba: "Identifier 'dragRef' has already been declared".
 *
 * SELF-TESTS: Pruebas ligeras en consola para validar RegExp y utilidades.
 */

// ------------------------- Prompts (Pop + Cine) -------------------------
const PROMPTS: string[] = [
  "Lightsaber Duel (Star Wars)",
  "Hobbiton at Dawn (LotR)",
  "Neo Dodging Bullets (Matrix)",
  "Jurassic Jungle (Jurassic Park)",
  "Mad Max Wasteland",
  "Cartoon Gotham (Batman retro)",
  "Kaiju Attack (Godzilla)",
  "Ecto-1 in Action (Ghostbusters)",
  "Cyberpunk Tokyo (Akira/Blade Runner)",
  "Back to the Future Hoverboard",
  "Wakanda Skyline (Black Panther)",
  "Arcade Stranger Things",
  "Quidditch Match (Harry Potter)",
  "Indiana Jones Temple Trap",
  "Spider-Verse Mashup",
  "The Shining Hallway",
  "Kaer Morhen Training (The Witcher)",
  "Dune Sandworms",
  "Studio Ghibli Feast",
  "Ghostly Hotel (Resplandor vibes)",
  "Treasure Planet Ship",
  "Pirates of the Caribbean Duel",
  "Pacific Rim Jaeger Battle",
  "Classic Universal Monsters",
  "Toy Story Western Scene",
  "Cybernetic Samurai (Kurosawa + Sci‑Fi)",
  "Disney Villains Tea Party",
  "Alien Facehugger Encounter",
  "Marvel Zombies",
  "Tim Burton’s Wonderland",
  "Cinematic Halloween Crossover"
];

// ------------------------- IndexedDB helpers -------------------------
const DB_NAME = "promptoberDB";
const STORE_NAME = "days";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idFor(year: number, day: number) {
  return `${year}-10-${day}`;
}

type DayState = {
  id: string; // `${year}-10-${day}`
  year: number;
  day: number; // 1..31
  done: boolean;
  tweetUrl?: string;
  manualImageUrls?: string[]; // URLs de imágenes añadidas manualmente
};

async function getDay(year: number, day: number): Promise<DayState | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(idFor(year, day));
    req.onsuccess = () => resolve(req.result as DayState | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function setDay(state: DayState): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(state);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getAllDays(): Promise<DayState[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as DayState[]) || []);
    req.onerror = () => reject(req.error);
  });
}

// ------------------------- Utils -------------------------
function getCurrentOctDay(): { year: number; day: number } {
  const now = new Date();
  const year = now.getFullYear();
  if (now.getMonth() === 9) {
    return { year, day: Math.min(Math.max(now.getDate(), 1), 31) };
  }
  return { year, day: 1 };
}

function extractImgSrcsFromHTML(html: string): string[] {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const imgs = Array.from(temp.querySelectorAll("img")) as HTMLImageElement[];
  const srcs = imgs.map((i) => i.src).filter(Boolean);
  return Array.from(new Set(srcs));
}

// Extrae imágenes desde una página de X usando el proxy r.jina.ai (best effort, sin garantías)
async function fetchTweetImagesViaProxy(tweetUrl: string): Promise<string[]> {
  try {
    const proxyUrl = `https://r.jina.ai/http://${tweetUrl.replace(/^https?:\/\//, "")}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return [];
    const text = await res.text();
    // RegExp para URLs de media en Twitter (pbs.twimg.com)
    const mediaRegex = /https?:\/\/pbs\.twimg\.com\/media\/[^"'\)\s]+/g; // ✅ sin flags inválidas
    const found = Array.from(new Set(text.match(mediaRegex) || []));
    return found.map((u) => u.replace(/&name=[a-zA-Z0-9_:-]+/, "&name=large"));
  } catch {
    return [];
  }
}

// ------------------------- Self Tests (ligeros, en consola) -------------------------
function runSelfTests() {
  try {
    // Test 1: split manual URLs
    const input = "https://a.com/1.jpg,\nhttps://b.com/2.png";
    const out = input.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    console.assert(out.length === 2 && out[0].includes("1.jpg") && out[1].includes("2.png"), "split RegExp fallo");

    // Test 2: media regex
    const sample = `img src=\"https://pbs.twimg.com/media/ABC123?format=jpg&name=small\" other https://pbs.twimg.com/media/XYZ789?format=jpg&name=large`;
    const mediaRegex = /https?:\/\/pbs\.twimg\.com\/media\/[^"'\)\s]+/g;
    const m = sample.match(mediaRegex) || [];
    console.assert(m.length === 2 && m[0].includes("ABC123") && m[1].includes("XYZ789"), "media RegExp fallo");

    // Test 3: extract from oEmbed HTML
    const html = '<div><img src="https://cdn.example.com/img.png"/></div>';
    const imgs = extractImgSrcsFromHTML(html);
    console.assert(imgs.length === 1 && imgs[0].includes("img.png"), "extractImgSrcs fallo");

    // Test 4: idFor helper
    console.assert(idFor(2025, 7) === "2025-10-7", "idFor fallo");

    // Test 5: prompt mapping bounds
    console.assert(PROMPTS.length === 31 && PROMPTS[0].length > 0 && PROMPTS[30].length > 0, "PROMPTS length/mapping fallo");
  } catch (e) {
    console.warn("Self-tests error (no crítico):", e);
  }
}

// ------------------------- Main Component -------------------------
export default function PromptoberApp() {
  const initial = useMemo(getCurrentOctDay, []);
  const [year] = useState<number>(initial.year);
  const [selectedDay, setSelectedDay] = useState<number>(initial.day);
  const [dayState, setDayState] = useState<DayState | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [oembedHTML, setOembedHTML] = useState<string>("");
  const [oembedImgs, setOembedImgs] = useState<string[]>([]);
  const [manualUrlsInput, setManualUrlsInput] = useState<string>("");
  const [allDaysCache, setAllDaysCache] = useState<Record<number, DayState>>({});

  // Ejecutar auto‑tests una vez en cliente
  useEffect(() => {
    runSelfTests();
  }, []);

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({ dragging: false, lastX: 0, lastY: 0 });

  const allImages = useMemo(() => {
    const manual = (dayState?.manualImageUrls || []).filter(Boolean);
    return [...oembedImgs, ...manual];
  }, [oembedImgs, dayState?.manualImageUrls]);

  // Auto‑marcar como hecho cuando pasan de 0 a >0 imágenes (sin re‑forzar si el usuario desmarca manualmente)
  const prevImgCountRef = useRef(0);
  useEffect(() => {
    const prev = prevImgCountRef.current;
    const curr = allImages.length;
    if (prev === 0 && curr > 0 && dayState && !dayState.done) {
      // marcar una única vez en la transición 0 -> >0
      persist({ done: true });
    }
    prevImgCountRef.current = curr;
  }, [allImages.length]);

  // Carga estado del día seleccionado + refresca cache para el calendario
  useEffect(() => {
    (async () => {
      const st = await getDay(year, selectedDay);
      setDayState(
        st ?? {
          id: idFor(year, selectedDay),
          year,
          day: selectedDay,
          done: false,
          tweetUrl: "",
          manualImageUrls: [],
        }
      );
      setOembedHTML("");
      setOembedImgs([]);
      setManualUrlsInput((st?.manualImageUrls || []).join(", "));
      const list = await getAllDays();
      const map: Record<number, DayState> = {};
      list.forEach((d) => (map[d.day] = d));
      setAllDaysCache(map);
    })();
  }, [year, selectedDay]);

  async function persist(partial: Partial<DayState>) {
    if (!dayState) return;
    const next = { ...dayState, ...partial } as DayState;
    setDayState(next);
    await setDay(next);
    setAllDaysCache((m) => ({ ...m, [next.day]: next }));
  }

  async function toggleDone(e: React.ChangeEvent<HTMLInputElement>) {
    await persist({ done: e.target.checked });
  }

  // Inserta el bloque del tuit y trata de extraer imágenes (oEmbed + proxy)
  async function handleTweetFetch() {
    if (!dayState) return;
    const url = dayState.tweetUrl?.trim();
    if (!url) return;
    setLoading(true);
    setOembedHTML("");
    setOembedImgs([]);
    try {
      // 1) Cargar oEmbed (render del tuit)
      const endpoint = `https://publish.x.com/oembed?omit_script=0&hide_thread=1&url=${encodeURIComponent(url)}`;
      const res = await fetch(endpoint);
      let html = "";
      if (res.ok) {
        const data = await res.json();
        html = data?.html || "";
        setOembedHTML(html);
        // inyectar script de widgets si no existe
        if (!document.querySelector('script[src*="platform.twitter.com/widgets.js"]')) {
          const s = document.createElement("script");
          s.src = "https://platform.twitter.com/widgets.js";
          s.async = true;
          document.body.appendChild(s);
        }
      }
      // 2) Intento de extraer imágenes (best effort)
      let images: string[] = extractImgSrcsFromHTML(html);
      if (!images.length) {
        const viaProxy = await fetchTweetImagesViaProxy(url);
        images = viaProxy;
      }
      setOembedImgs(images);
    } catch (e) {
      console.warn("oEmbed/proxy error: ", e);
    } finally {
      setLoading(false);
    }
  }

  function handleManualUrlsSave() {
    const urls = manualUrlsInput
      .split(/[\n,]/) // ✅ corregido (antes tenía un salto de línea dentro del literal)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    persist({ manualImageUrls: urls });
  }

  async function handleExport() {
    const all = await getAllDays();
    const payload = { year, month: 10, data: all };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `promptober-${year}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(String(reader.result));
        const list: DayState[] = json?.data || [];
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          list.forEach((d) => store.put(d));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        const st = await getDay(year, selectedDay);
        setDayState(st);
        const all = await getAllDays();
        const map: Record<number, DayState> = {};
        all.forEach((d) => (map[d.day] = d));
        setAllDaysCache(map);
      } catch (err) {
        console.error("Import error", err);
      }
    };
    reader.readAsText(file);
  }

  // Lightbox handlers
  function openLightbox(idx: number) {
    setLightboxIndex(idx);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    setLightboxOpen(true);
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY / 500;
    setZoom((z) => Math.max(1, Math.min(8, z + delta)));
  }

  function onMouseDown(e: React.MouseEvent) {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current.dragging || zoom === 1) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    setPan({ ...panRef.current });
  }
  function onMouseUp() {
    dragRef.current.dragging = false;
  }

  const idx = Math.min(Math.max(selectedDay - 1, 0), PROMPTS.length - 1);
  const promptText = PROMPTS[idx];

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Promptober Pop‑Cine</h1>
          <p className="text-sm text-muted-foreground">Octubre {year} · Datos guardados localmente (IndexedDB)</p>
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent" onClick={handleExport}>Exportar JSON</button>
          <label className="inline-flex items-center gap-2">
            <input type="file" accept="application/json" className="hidden" onChange={handleImport} id="importFile" />
            <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent" onClick={() => (document.getElementById("importFile") as HTMLInputElement)?.click()}>Importar JSON</button>
          </label>
        </div>
      </header>

      {/* Top Card */}
      <section className="mb-8 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Día {selectedDay} · Octubre</div>
            <h2 className="text-xl font-semibold">{promptText}</h2>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-2"
              checked={!!dayState?.done}
              onChange={toggleDone}
            />
            Marcado como realizado
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">URL del tuit de X (con tus imágenes)</label>
            <div className="flex gap-2">
              <input
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                placeholder="https://x.com/usuario/status/123456..."
                value={dayState?.tweetUrl ?? ""}
                onChange={(e) => persist({ tweetUrl: e.target.value })}
              />
              <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent" onClick={handleTweetFetch} disabled={loading}>{loading ? "Cargando…" : "Cargar"}</button>
            </div>
            <p className="text-xs text-muted-foreground">Se usa oEmbed y un intento de extracción automática. Si no aparecen, añade URLs manuales abajo.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">URLs de imágenes manuales (opcional; separa por comas o líneas)</label>
            <textarea
              className="min-h-[80px] w-full rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="https://.../img1.jpg, https://.../img2.png"
              value={manualUrlsInput}
              onChange={(e) => setManualUrlsInput(e.target.value)}
              onBlur={handleManualUrlsSave}
            />
            <div className="flex gap-2">
              <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent" onClick={handleManualUrlsSave}>Guardar imágenes</button>
              <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent" onClick={() => { setManualUrlsInput(""); persist({ manualImageUrls: [] }); }}>Limpiar</button>
            </div>
          </div>
        </div>

        {/* Tweet embed (si existe) */}
        {!!oembedHTML && (
          <div className="mt-4 overflow-hidden rounded-xl border bg-background p-3" dangerouslySetInnerHTML={{ __html: oembedHTML }} />
        )}

        {/* Galería de imágenes */}
        {allImages.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {allImages.map((src, idx) => (
              <button key={idx} onClick={() => openLightbox(idx)} className="group overflow-hidden rounded-xl border bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`media-${idx}`} className="h-36 w-full object-cover transition-transform duration-200 group-hover:scale-105" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Calendario de Octubre con prompts (tooltip) y estado */}
      <section className="mb-10 rounded-2xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-lg font-semibold">Calendario · Octubre</h3>
        <CalendarOctober
          year={year}
          selectedDay={selectedDay}
          allDays={allDaysCache}
          onSelect={(d) => setSelectedDay(d)}
        />
      </section>

      <footer className="text-center text-xs text-muted-foreground">
        Tus datos se almacenan <strong>solo en este dispositivo</strong> mediante IndexedDB (modo local/"localhost").
      </footer>

      {/* Lightbox */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <div className="mx-auto w-full max-w-5xl rounded-lg bg-background p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm">Vista previa ({lightboxIndex + 1}/{allImages.length})</div>
              <button className="rounded border px-2 py-1 text-sm" onClick={() => setLightboxOpen(false)}>Cerrar</button>
            </div>
            <div className="relative flex h-[70vh] w-full items-center justify-center overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={allImages[lightboxIndex]}
                alt="zoomable"
                className="select-none"
                draggable={false}
                onWheel={onWheel}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center center", maxWidth: "100%", maxHeight: "100%" }}
              />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setZoom(1)}>Reset zoom</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length)}>Anterior</button>
              <button className="rounded border px-3 py-2 text-sm" onClick={() => setLightboxIndex((i) => (i + 1) % allImages.length)}>Siguiente</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarOctober({ year, selectedDay, onSelect, allDays }: { year: number; selectedDay: number; onSelect: (d: number) => void; allDays: Record<number, DayState> }) {
  const firstDow = new Date(year, 9, 1).getDay(); // 0=Domingo
  const daysInMonth = 31;

  const weeks: (number | null)[][] = [];
  let day = 1;
  const startPad = (firstDow + 6) % 7; // semana empieza en Lunes

  for (let w = 0; w < 6; w++) {
    const row: (number | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const cellIndex = w * 7 + d;
      if (cellIndex < startPad || day > daysInMonth) {
        row.push(null);
      } else {
        row.push(day++);
      }
    }
    weeks.push(row);
  }

  const dow = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {dow.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 auto-rows-min">
        {weeks.flat().map((d, i) => {
          const isSel = d === selectedDay;
          const done = d ? allDays[d]?.done : false;
          const prompt = typeof d === "number" ? PROMPTS[d - 1] : "";
          const short = prompt ? (prompt.length > 12 ? prompt.slice(0, 12) + "…" : prompt) : "";
          return (
            <button
              key={i}
              disabled={!d}
              onClick={() => d && onSelect(d)}
              title={d ? `Día ${d} — ${prompt}` : ""}
              className={`relative flex w-full flex-col items-start justify-start rounded-lg border p-2 text-left text-xs transition ${
                d
                  ? isSel
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : done
                      ? "bg-green-100 dark:bg-green-900/30"
                      : "bg-card hover:bg-accent"
                  : "opacity-40"
              }`}
            >
              {/* Número del día en la esquina superior izquierda */}
              <span className="pointer-events-none absolute left-1 top-1 text-[10px] font-semibold opacity-80">{d ?? ""}</span>

              {/* Punto verde si está hecho */}
              {done && <span className="pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-green-500" />}

              {/* Contenido completo del prompt */}
              {d && (
                <div className="mt-4 w-full whitespace-normal break-words text-[11px] leading-tight">
                  {prompt}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
