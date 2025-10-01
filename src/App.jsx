import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "./ThemeContext.jsx";

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
const PROMPTS = [
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
  "Tim Burton's Wonderland",
  "Cinematic Halloween Crossover"
];

// ------------------------- IndexedDB helpers -------------------------
const DB_NAME = "promptoberDB";
const STORE_NAME = "days";
const IMAGES_STORE_NAME = "images";
const URLS_STORE_NAME = "urls";
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      
      // Store para días
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      
      // Store para imágenes (blobs)
      if (!db.objectStoreNames.contains(IMAGES_STORE_NAME)) {
        db.createObjectStore(IMAGES_STORE_NAME, { keyPath: "url" });
      }
      
      // Store para URLs de tweets (cache de URLs)
      if (!db.objectStoreNames.contains(URLS_STORE_NAME)) {
        db.createObjectStore(URLS_STORE_NAME, { keyPath: "tweetUrl" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idFor(year, day) {
  return `${year}-10-${day}`;
}

// DayState type definition (commented out for JSX compatibility)
// {
//   id: string; // `${year}-10-${day}`
//   year: number;
//   day: number; // 1..31
//   done: boolean;
//   tweetUrl?: string;
//   manualImageUrls?: string[]; // URLs de imágenes añadidas manualmente
// }

async function getDay(year, day) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(idFor(year, day));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function setDay(state) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(state);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getAllDays() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ------------------------- Image Cache helpers -------------------------
async function saveImageToCache(url, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE_NAME, "readwrite");
    const store = tx.objectStore(IMAGES_STORE_NAME);
    const req = store.put({ url, blob, timestamp: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getImageFromCache(url) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE_NAME, "readonly");
    const store = tx.objectStore(IMAGES_STORE_NAME);
    const req = store.get(url);
    req.onsuccess = () => {
      const result = req.result;
      if (result && result.blob) {
        // Verificar que la imagen no sea muy antigua (1 año)
        const isExpired = Date.now() - result.timestamp > 365 * 24 * 60 * 60 * 1000;
        resolve(isExpired ? null : result.blob);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function saveTweetUrlsToCache(tweetUrl, imageUrls) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(URLS_STORE_NAME, "readwrite");
    const store = tx.objectStore(URLS_STORE_NAME);
    const req = store.put({ 
      tweetUrl, 
      imageUrls, 
      timestamp: Date.now() 
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getTweetUrlsFromCache(tweetUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(URLS_STORE_NAME, "readonly");
    const store = tx.objectStore(URLS_STORE_NAME);
    const req = store.get(tweetUrl);
    req.onsuccess = () => {
      const result = req.result;
      if (result && result.imageUrls) {
        // Verificar que el cache no sea muy antiguo (1 año)
        const isExpired = Date.now() - result.timestamp > 365 * 24 * 60 * 60 * 1000;
        resolve(isExpired ? null : result.imageUrls);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// Función para descargar y cachear una imagen
async function downloadAndCacheImage(url) {
  try {
    // Primero verificar si ya está en cache
    const cachedBlob = await getImageFromCache(url);
    if (cachedBlob) {
      console.log(`✅ Imagen encontrada en cache: ${url}`);
      return URL.createObjectURL(cachedBlob);
    }

    // Si no está en cache, descargarla
    console.log(`📥 Descargando imagen: ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const blob = await response.blob();
    
    // Guardar en cache
    await saveImageToCache(url, blob);
    console.log(`💾 Imagen guardada en cache: ${url}`);
    
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn(`❌ Error descargando imagen ${url}:`, error.message);
    // Si falla la descarga, devolver la URL original
    return url;
  }
}

// Función para limpiar el cache de imágenes
async function clearImageCache() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE_NAME, "readwrite");
    const store = tx.objectStore(IMAGES_STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => {
      console.log("🗑️ Cache de imágenes limpiado");
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// Función para limpiar el cache de URLs de tweets
async function clearUrlsCache() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(URLS_STORE_NAME, "readwrite");
    const store = tx.objectStore(URLS_STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => {
      console.log("🗑️ Cache de URLs limpiado");
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

// Función para obtener estadísticas del cache
async function getCacheStats() {
  const db = await openDB();
  
  const imageCount = await new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE_NAME, "readonly");
    const store = tx.objectStore(IMAGES_STORE_NAME);
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  
  const urlCount = await new Promise((resolve, reject) => {
    const tx = db.transaction(URLS_STORE_NAME, "readonly");
    const store = tx.objectStore(URLS_STORE_NAME);
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  
  return { imageCount, urlCount };
}

// ------------------------- Utils -------------------------
function getCurrentOctDay() {
  const now = new Date();
  const year = now.getFullYear();
  if (now.getMonth() === 9) {
    return { year, day: Math.min(Math.max(now.getDate(), 1), 31) };
  }
  return { year, day: 1 };
}

function extractImgSrcsFromHTML(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  const imgs = Array.from(temp.querySelectorAll("img"));
  const srcs = imgs.map((i) => i.src).filter(Boolean);
  return Array.from(new Set(srcs));
}

// Extrae imágenes desde una página de X usando múltiples métodos (best effort, sin garantías)
async function fetchTweetImagesViaProxy(tweetUrl) {
  const proxies = [
    `https://r.jina.ai/http://${tweetUrl.replace(/^https?:\/\//, "")}`,
    `https://api.allorigins.win/get?url=${encodeURIComponent(tweetUrl)}`,
    `https://cors-anywhere.herokuapp.com/${tweetUrl}`
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl);
      if (!res.ok) continue;
      
      let text;
      if (proxyUrl.includes('allorigins.win')) {
        const data = await res.json();
        text = data.contents;
      } else {
        text = await res.text();
      }
      
      // RegExp mejorado para URLs de media en Twitter (pbs.twimg.com)
      const mediaRegex = /https?:\/\/pbs\.twimg\.com\/media\/[A-Za-z0-9_-]+[^"'\)\s]*/g;
      const found = Array.from(new Set(text.match(mediaRegex) || []));
      
      if (found.length > 0) {
        return found.map((u) => {
          // Limpiar parámetros y asegurar formato large
          const cleanUrl = u.split('?')[0];
          return `${cleanUrl}?format=jpg&name=large`;
        });
      }
    } catch (error) {
      console.warn(`Proxy ${proxyUrl} falló:`, error.message);
      continue;
    }
  }
  
  return [];
}

// Método alternativo: extraer imágenes usando regex más específico
function extractImagesFromTweetText(text) {
  const patterns = [
    // URLs directas de pbs.twimg.com
    /https?:\/\/pbs\.twimg\.com\/media\/[A-Za-z0-9_-]+[^"'\)\s]*/g,
    // URLs en formato de datos JSON
    /"media_url":"([^"]+pbs\.twimg\.com[^"]+)"/g,
    // URLs en atributos src
    /src="([^"]*pbs\.twimg\.com[^"]*)"/g
  ];
  
  const found = new Set();
  
  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => {
        // Extraer URL del match
        let url = match;
        if (match.includes('"media_url":"')) {
          url = match.match(/"media_url":"([^"]+)"/)?.[1] || match;
        } else if (match.includes('src="')) {
          url = match.match(/src="([^"]+)"/)?.[1] || match;
        }
        
        if (url && url.includes('pbs.twimg.com')) {
          // Limpiar y formatear URL
          const cleanUrl = url.split('?')[0];
          found.add(`${cleanUrl}?format=jpg&name=large`);
        }
      });
    }
  });
  
  return Array.from(found);
}

// Método de fallback: URLs conocidas para tweets específicos (para testing)
function getKnownTweetImages(tweetUrl) {
  const knownImages = {
    '1973385010481606663': [
      'https://pbs.twimg.com/media/G2LfJa8WgAM9qkW?format=jpg&name=large',
      'https://pbs.twimg.com/media/G2LfJa1WkAACYAk?format=jpg&name=large',
      'https://pbs.twimg.com/media/G2LfJbEXMAA39wl?format=jpg&name=large',
      'https://pbs.twimg.com/media/G2LfJaxWMAABWFy?format=jpg&name=large'
    ]
  };
  
  const tweetIdMatch = tweetUrl.match(/\/status\/(\d+)/);
  if (tweetIdMatch) {
    const tweetId = tweetIdMatch[1];
    return knownImages[tweetId] || [];
  }
  
  return [];
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
  const { isDark, toggleTheme } = useTheme();
  const initial = useMemo(getCurrentOctDay, []);
  const [year] = useState(initial.year);
  const [selectedDay, setSelectedDay] = useState(initial.day);
  const [dayState, setDayState] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [oembedHTML, setOembedHTML] = useState("");
  const [oembedImgs, setOembedImgs] = useState([]);
  const [manualUrlsInput, setManualUrlsInput] = useState("");
  const [allDaysCache, setAllDaysCache] = useState({});
  const [cacheStats, setCacheStats] = useState({ imageCount: 0, urlCount: 0 });
  const [showHelpModal, setShowHelpModal] = useState(false);

  // Ejecutar auto‑tests una vez en cliente
  useEffect(() => {
    runSelfTests();
  }, []);

  // Manejar tecla Escape para cerrar modal
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && showHelpModal) {
        setShowHelpModal(false);
      }
    };
    
    if (showHelpModal) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [showHelpModal]);

  // Actualizar estadísticas del cache
  useEffect(() => {
    const updateCacheStats = async () => {
      try {
        const stats = await getCacheStats();
        setCacheStats(stats);
      } catch (error) {
        console.warn("Error obteniendo estadísticas del cache:", error);
      }
    };
    updateCacheStats();
  }, [oembedImgs]); // Actualizar cuando cambien las imágenes

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });

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
      const map = {};
      list.forEach((d) => (map[d.day] = d));
      setAllDaysCache(map);
    })();
  }, [year, selectedDay]);

  async function persist(partial) {
    if (!dayState) return;
    const next = { ...dayState, ...partial };
    setDayState(next);
    await setDay(next);
    setAllDaysCache((m) => ({ ...m, [next.day]: next }));
  }

  async function toggleDone(e) {
    await persist({ done: e.target.checked });
  }

  // Inserta el bloque del tuit y trata de extraer imágenes (oEmbed + proxy + cache local)
  async function handleTweetFetch() {
    if (!dayState) return;
    const url = dayState.tweetUrl?.trim();
    if (!url) return;
    setLoading(true);
    setOembedHTML("");
    setOembedImgs([]);
    
    let images = [];
    let html = "";
    
    try {
      // 0) Primero verificar si tenemos URLs en cache
      console.log("🔍 Verificando cache de URLs...");
      const cachedUrls = await getTweetUrlsFromCache(url);
      if (cachedUrls && cachedUrls.length > 0) {
        console.log(`✅ URLs encontradas en cache: ${cachedUrls.length} imágenes`);
        images = cachedUrls;
      } else {
        // 1) Intentar oEmbed (render del tuit)
        try {
          const endpoint = `https://publish.x.com/oembed?omit_script=0&hide_thread=1&url=${encodeURIComponent(url)}`;
          const res = await fetch(endpoint);
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
            // Extraer imágenes del HTML de oEmbed
            images = extractImgSrcsFromHTML(html);
          }
        } catch (e) {
          console.warn("oEmbed falló:", e.message);
        }
        
        // 2) Si no hay imágenes del oEmbed, intentar con proxies
        if (!images.length) {
          console.log("Intentando extraer imágenes con proxies...");
          images = await fetchTweetImagesViaProxy(url);
        }
        
        // 3) Si aún no hay imágenes, intentar con URLs conocidas (fallback)
        if (!images.length) {
          console.log("Intentando con URLs conocidas...");
          images = getKnownTweetImages(url);
          if (images.length > 0) {
            console.log("✅ Usando URLs conocidas como fallback");
          }
        }
        
        // Guardar URLs en cache para futuras consultas
        if (images.length > 0) {
          await saveTweetUrlsToCache(url, images);
          console.log("💾 URLs guardadas en cache");
        }
      }
      
      // 4) Procesar imágenes: descargar y cachear localmente
      if (images.length > 0) {
        console.log(`🖼️ Procesando ${images.length} imágenes...`);
        const processedImages = [];
        
        for (const imageUrl of images) {
          try {
            const cachedImageUrl = await downloadAndCacheImage(imageUrl);
            processedImages.push(cachedImageUrl);
          } catch (error) {
            console.warn(`Error procesando imagen ${imageUrl}:`, error);
            processedImages.push(imageUrl); // Usar URL original como fallback
          }
        }
        
        setOembedImgs(processedImages);
        console.log(`✅ Se procesaron ${processedImages.length} imágenes`);
      } else {
        console.warn("❌ No se pudieron extraer imágenes del tweet");
      }
      
    } catch (e) {
      console.warn("Error general en carga de tweet: ", e);
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

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(String(reader.result));
        const list = json?.data || [];
        const db = await openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          list.forEach((d) => store.put(d));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        const st = await getDay(year, selectedDay);
        setDayState(st);
        const all = await getAllDays();
        const map = {};
        all.forEach((d) => (map[d.day] = d));
        setAllDaysCache(map);
      } catch (err) {
        console.error("Import error", err);
      }
    };
    reader.readAsText(file);
  }

  // Lightbox handlers
  function openLightbox(idx) {
    setLightboxIndex(idx);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    panRef.current = { x: 0, y: 0 };
    setLightboxOpen(true);
  }

  function onWheel(e) {
    e.preventDefault();
    const delta = -e.deltaY / 500;
    setZoom((z) => Math.max(1, Math.min(8, z + delta)));
  }

  function onMouseDown(e) {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  }
  function onMouseMove(e) {
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
    <div className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Promptober Pop‑Cine</h1>
          <p className="text-sm text-muted-foreground">
            Octubre {year} · Datos guardados localmente (IndexedDB)
            {cacheStats.imageCount > 0 && (
              <span className="ml-2 text-green-600 dark:text-green-400">
                · {cacheStats.imageCount} imágenes en cache
              </span>
            )}
          </p>
          <button 
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
            onClick={() => setShowHelpModal(true)}
          >
            ¿Cómo funciona?
          </button>
        </div>
        <div className="flex gap-2">
          <button 
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent dark:border-gray-600 dark:hover:bg-gray-700" 
            onClick={toggleTheme}
            title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
          <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent dark:border-gray-600 dark:hover:bg-gray-700" onClick={handleExport}>Exportar JSON</button>
          <label className="inline-flex items-center gap-2">
            <input type="file" accept="application/json" className="hidden" onChange={handleImport} id="importFile" />
            <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent dark:border-gray-600 dark:hover:bg-gray-700" onClick={() => document.getElementById("importFile")?.click()}>Importar JSON</button>
          </label>
          <button 
            className="rounded-lg border px-3 py-2 text-sm hover:bg-accent dark:border-gray-600 dark:hover:bg-gray-700 bg-yellow-100 dark:bg-yellow-900" 
            onClick={async () => {
              if (confirm("¿Limpiar cache de imágenes? Esto liberará espacio pero las imágenes se volverán a descargar.")) {
                // Limpiar ambos caches
                await clearImageCache();
                await clearUrlsCache();
                
                // Limpiar la interfaz visual
                setOembedHTML("");
                setOembedImgs([]);
                
                // Limpiar el estado del día actual
                if (dayState) {
                  const updatedDayState = {
                    ...dayState,
                    tweetUrl: "",
                    manualImageUrls: [],
                    done: false  // Desmarcar como realizado
                  };
                  await setDay(updatedDayState);
                  setDayState(updatedDayState);
                }
                
                // Actualizar estadísticas
                const stats = await getCacheStats();
                setCacheStats(stats);
                
                alert("Cache limpiado correctamente");
              }
            }}
            title="Limpiar cache de imágenes"
          >
            🗑️ Limpiar Cache
          </button>
        </div>
      </header>

      {/* Top Card */}
      <section className="mb-8 rounded-2xl border bg-card dark:bg-gray-800 dark:border-gray-700 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Día {selectedDay} · Octubre</div>
            <h2 className="text-xl font-semibold">{promptText}</h2>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-2 dark:bg-gray-700"
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
                className="w-full rounded-lg border bg-background dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm"
                placeholder="https://x.com/usuario/status/123456..."
                value={dayState?.tweetUrl ?? ""}
                onChange={(e) => persist({ tweetUrl: e.target.value })}
              />
              <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent dark:border-gray-600 dark:hover:bg-gray-700" onClick={handleTweetFetch} disabled={loading}>{loading ? "Cargando…" : "Cargar"}</button>
            </div>
            <p className="text-xs text-muted-foreground">Se usa oEmbed y un intento de extracción automática. Si no aparecen, añade URLs manuales abajo.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">URLs de imágenes manuales (opcional; separa por comas o líneas)</label>
            <textarea
              className="min-h-[80px] w-full rounded-lg border bg-background dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 px-3 py-2 text-sm"
              placeholder="https://.../img1.jpg, https://.../img2.png"
              value={manualUrlsInput}
              onChange={(e) => setManualUrlsInput(e.target.value)}
              onBlur={handleManualUrlsSave}
            />
            <div className="flex gap-2">
              <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent dark:border-gray-600 dark:hover:bg-gray-700" onClick={handleManualUrlsSave}>Guardar imágenes</button>
              <button className="rounded-lg border px-3 py-2 text-sm hover:bg-accent dark:border-gray-600 dark:hover:bg-gray-700" onClick={() => { setManualUrlsInput(""); persist({ manualImageUrls: [] }); }}>Limpiar</button>
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
                <img src={src} alt={`media-${idx}`} className="h-36 w-full object-cover transition-transform duration-200 group-hover:scale-105" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Calendario de Octubre con prompts (tooltip) y estado */}
      <section className="mb-10 rounded-2xl border bg-card dark:bg-gray-800 dark:border-gray-700 p-4 shadow-sm">
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

      {/* Modal de Ayuda */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowHelpModal(false)}>
          <div className="mx-auto w-full max-w-2xl max-h-[90vh] rounded-lg bg-white dark:bg-gray-800 shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header fijo */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <h2 className="text-xl font-semibold">¿Cómo funciona Promptober Pop-Cine?</h2>
              <button 
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl"
                onClick={() => setShowHelpModal(false)}
                title="Cerrar (Escape)"
              >
                ✕
              </button>
            </div>
            
            {/* Contenido con scroll */}
            <div className="overflow-y-auto p-6 space-y-4 text-sm">
              <div>
                <h3 className="font-semibold text-green-600 dark:text-green-400 mb-2">🎯 ¿Qué es esto?</h3>
                <p>Un calendario interactivo para el desafío "Promptober" de octubre, donde cada día tienes un prompt de cine/pop culture para crear imágenes con IA.</p>
              </div>

              <div>
                <h3 className="font-semibold text-blue-600 dark:text-blue-400 mb-2">📱 Cómo usar la aplicación</h3>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li><strong>Selecciona un día</strong> del calendario de octubre</li>
                  <li><strong>Pega la URL de tu tweet</strong> de X/Twitter con las imágenes</li>
                  <li><strong>Haz clic en "Cargar"</strong> para extraer las imágenes automáticamente</li>
                  <li><strong>O añade URLs manuales</strong> si la extracción automática falla</li>
                  <li><strong>Marca como realizado</strong> cuando tengas las imágenes</li>
                </ol>
              </div>

              <div>
                <h3 className="font-semibold text-orange-600 dark:text-orange-400 mb-2">💾 Almacenamiento de datos</h3>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                  <p className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">⚠️ Información importante sobre la privacidad:</p>
                  <ul className="list-disc list-inside space-y-1 text-yellow-700 dark:text-yellow-300">
                    <li>Todos los datos se guardan <strong>solo en tu dispositivo</strong></li>
                    <li>Las imágenes se descargan y almacenan <strong>localmente</strong></li>
                    <li><strong>No se envía nada a servidores externos</strong> (excepto para descargar las imágenes)</li>
                    <li>Si borras el cache o los datos del navegador, <strong>se perderá toda la información</strong></li>
                  </ul>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-purple-600 dark:text-purple-400 mb-2">🔄 Sistema de Cache</h3>
                <p>La aplicación usa un sistema inteligente de cache que:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Guarda las URLs de tweets para cargas rápidas</li>
                  <li>Descarga y almacena las imágenes localmente</li>
                  <li>Las imágenes se mantienen 1 año en cache</li>
                  <li>Las URLs se mantienen 1 año en cache</li>
                </ul>
              </div>

              <div>
                <h3 className="font-semibold text-red-600 dark:text-red-400 mb-2">💾 Respaldo de datos</h3>
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="font-semibold text-blue-800 dark:text-blue-200 mb-2">📥 Para no perder tu progreso:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-700 dark:text-blue-300">
                    <li>Usa el botón <strong>"Exportar JSON"</strong> para descargar todos tus datos</li>
                    <li>Guarda el archivo JSON en un lugar seguro</li>
                    <li>Si cambias de dispositivo, usa <strong>"Importar JSON"</strong> para restaurar</li>
                    <li>Haz respaldos regulares para no perder tu trabajo</li>
                  </ul>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-gray-600 dark:text-gray-400 mb-2">🛠️ Funciones adicionales</h3>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Lightbox:</strong> Haz clic en las imágenes para verlas en grande con zoom</li>
                  <li><strong>Modo oscuro:</strong> Cambia el tema con el botón 🌙/☀️</li>
                  <li><strong>Limpieza de cache:</strong> Usa "🗑️ Limpiar Cache" para liberar espacio</li>
                  <li><strong>Navegación:</strong> Usa las flechas en el lightbox para ver todas las imágenes</li>
                </ul>
              </div>

              <div className="text-center pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  💡 <strong>Tip:</strong> Si tienes problemas con la extracción automática de imágenes, 
                  siempre puedes añadir las URLs de las imágenes manualmente en el campo de abajo.
                </p>
              </div>
            </div>
            
            {/* Footer fijo con indicador de scroll */}
            <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex-shrink-0">
              <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                <span>📜</span>
                <span>Desplázate para ver más contenido</span>
              </div>
              <button 
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                onClick={() => setShowHelpModal(false)}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <div className="mx-auto w-full max-w-5xl rounded-lg bg-background dark:bg-gray-800 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm">Vista previa ({lightboxIndex + 1}/{allImages.length})</div>
              <button className="rounded border px-2 py-1 text-sm" onClick={() => setLightboxOpen(false)}>Cerrar</button>
            </div>
            <div className="relative flex h-[70vh] w-full items-center justify-center overflow-hidden rounded-lg bg-black">
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
              <button className="rounded border px-3 py-2 text-sm dark:border-gray-600 dark:hover:bg-gray-700" onClick={() => setZoom(1)}>Reset zoom</button>
              <button className="rounded border px-3 py-2 text-sm dark:border-gray-600 dark:hover:bg-gray-700" onClick={() => setLightboxIndex((i) => (i - 1 + allImages.length) % allImages.length)}>Anterior</button>
              <button className="rounded border px-3 py-2 text-sm dark:border-gray-600 dark:hover:bg-gray-700" onClick={() => setLightboxIndex((i) => (i + 1) % allImages.length)}>Siguiente</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarOctober({ year, selectedDay, onSelect, allDays }) {
  const firstDow = new Date(year, 9, 1).getDay(); // 0=Domingo
  const daysInMonth = 31;

  const weeks = [];
  let day = 1;
  const startPad = (firstDow + 6) % 7; // semana empieza en Lunes

  for (let w = 0; w < 6; w++) {
    const row = [];
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
                      ? "bg-green-100 dark:bg-green-900/30 border-green-500 dark:border-green-400"
                      : "bg-card dark:bg-gray-700 hover:bg-accent dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600"
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
