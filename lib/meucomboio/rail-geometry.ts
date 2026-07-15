// MeuComboioPT: geometria da rota SOBRE OS TRILHOS.
// O GTFS da CP não traz shapes.txt, por isso a linha do percurso é obtida do
// OpenStreetMap: pede-se a rede ferroviária num corredor à volta das estações
// (Overpass), constrói-se um grafo pelos IDs de nó do OSM e faz-se o caminho
// mais curto sobre o trilho entre estações consecutivas.
//
// Best-effort: se o Overpass falhar ou um troço ficar desconexo, cai para a
// linha reta desse troço. A geometria é estática → cache em memória por rota.

type LatLon = { lat: number; lon: number };
type Coord = [number, number]; // [lon, lat] (formato GeoJSON/MapLibre)

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const CORRIDOR_RADIUS_M = 4000;
const FETCH_TIMEOUT_MS = 12000;

const cache = new Map<string, Coord[]>();

const hav = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180;
  const dLat = (c - a) * r;
  const dLon = (d - b) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

type OverpassWay = { type: string; nodes?: number[]; geometry?: { lat: number; lon: number }[] };

async function fetchRailNetwork(stops: LatLon[]): Promise<OverpassWay[]> {
  const poly = stops.flatMap((s) => [s.lat, s.lon]).join(",");
  const query = `[out:json][timeout:25];way(around:${CORRIDOR_RADIUS_M},${poly})["railway"="rail"];out geom;`;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "MeuComboioPT/1.0 (aragontecnologia.com)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { elements: OverpassWay[] };
      const ways = data.elements.filter((e) => e.type === "way" && e.geometry && e.nodes);
      if (ways.length) return ways;
    } catch {
      // tenta o próximo endpoint
    }
  }
  return [];
}

// Min-heap simples para o Dijkstra (evita O(V²) e bloqueio do event loop).
class MinHeap {
  private a: [number, number][] = []; // [dist, node]
  push(item: [number, number]) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && a[l][0] < a[s][0]) s = l;
        if (r < a.length && a[r][0] < a[s][0]) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

type Graph = { adj: Map<number, [number, number][]>; coord: Map<number, Coord> };

function buildGraph(ways: OverpassWay[]): Graph {
  const adj = new Map<number, [number, number][]>();
  const coord = new Map<number, Coord>();
  const add = (id: number, lat: number, lon: number) => {
    if (!adj.has(id)) {
      adj.set(id, []);
      coord.set(id, [lon, lat]);
    }
  };
  for (const w of ways) {
    const g = w.geometry!;
    const n = w.nodes!;
    for (let i = 0; i < g.length - 1; i++) {
      add(n[i], g[i].lat, g[i].lon);
      add(n[i + 1], g[i + 1].lat, g[i + 1].lon);
      const d = hav(g[i].lat, g[i].lon, g[i + 1].lat, g[i + 1].lon);
      adj.get(n[i])!.push([n[i + 1], d]);
      adj.get(n[i + 1])!.push([n[i], d]);
    }
  }
  return { adj, coord };
}

function nearestNode(graph: Graph, lat: number, lon: number): number | null {
  let best: number | null = null;
  let bd = Infinity;
  for (const [id, [lo, la]] of graph.coord) {
    const d = hav(lat, lon, la, lo);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

function shortestPath(graph: Graph, src: number, dst: number): Coord[] | null {
  const dist = new Map<number, number>([[src, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const heap = new MinHeap();
  heap.push([0, src]);
  while (heap.size) {
    const [d, u] = heap.pop()!;
    if (done.has(u)) continue;
    done.add(u);
    if (u === dst) break;
    for (const [v, w] of graph.adj.get(u) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        heap.push([nd, v]);
      }
    }
  }
  if (src !== dst && !prev.has(dst)) return null;
  const path: Coord[] = [];
  let c: number | undefined = dst;
  while (c !== undefined) {
    path.unshift(graph.coord.get(c)!);
    if (c === src) break;
    c = prev.get(c);
  }
  return path;
}

// Devolve a polilinha [lon,lat] que segue o trilho ao longo das paragens.
// Fallback total = as próprias coordenadas das estações (linha reta).
export async function fetchRailShape(cacheKey: string, stops: LatLon[]): Promise<Coord[]> {
  const straight: Coord[] = stops.map((s) => [s.lon, s.lat]);
  if (stops.length < 2) return straight;

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const ways = await fetchRailNetwork(stops);
  if (!ways.length) return straight;

  const graph = buildGraph(ways);
  const snapped = stops.map((s) => nearestNode(graph, s.lat, s.lon));

  const shape: Coord[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = snapped[i];
    const b = snapped[i + 1];
    const seg = a != null && b != null ? shortestPath(graph, a, b) : null;
    const piece = seg && seg.length > 1 ? seg : [[stops[i].lon, stops[i].lat] as Coord, [stops[i + 1].lon, stops[i + 1].lat] as Coord];
    if (i > 0) piece.shift(); // evita duplicar o nó de junção
    shape.push(...piece);
  }

  if (shape.length >= 2) cache.set(cacheKey, shape);
  return shape.length >= 2 ? shape : straight;
}
