// MeuComboioPT: utilitários GTFS: parser CSV e conversões de tempo/data.

// Parser CSV conforme o GTFS (RFC 4180): campos entre aspas podem conter
// vírgulas, quebras de linha e aspas duplicadas. Devolve linhas como objetos
// indexados pelo cabeçalho.
export function parseCsv(text: string): Record<string, string>[] {
  // Remove BOM que a CP inclui nos ficheiros.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

// "HH:MM:SS" → segundos desde a meia-noite do dia de serviço. O GTFS permite
// horas >= 24 (comboios de madrugada do serviço do dia anterior).
export function timeToSecs(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function secsToHHMM(secs: number): string {
  const s = ((secs % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Data/hora atual em Lisboa (o servidor pode não estar em Europe/Lisbon).
export function lisbonNow(): { dateInt: number; weekday: number; secs: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dateInt = Number(`${get("year")}${get("month")}${get("day")}`);
  const secs = Number(get("hour")) % 24 * 3600 + Number(get("minute")) * 60 + Number(get("second"));
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekday = weekdayNames.indexOf(get("weekday")); // 0 = segunda
  return { dateInt, weekday, secs };
}

// Dia anterior de um yyyymmdd (para apanhar serviços com horas >= 24).
export function previousDate(dateInt: number): number {
  const y = Math.floor(dateInt / 10000);
  const m = Math.floor((dateInt % 10000) / 100) - 1;
  const d = dateInt % 100;
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

// Distância haversine em km (para a estação mais próxima).
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
