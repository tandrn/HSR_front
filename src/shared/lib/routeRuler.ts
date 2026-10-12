import type { GeoPoint } from '../../bridge/schema';
import { haversineDistanceKm } from './routeGeometry';

/**
 * Линейка по трассе: перевод клика на карте в отметку на линии и обратно.
 *
 * Студент в ПЗ3 меряет участки уже проложенной трассы, а не расстояния по
 * прямой. Поэтому измерение идёт вдоль ломаной: клик притягивается к ближайшей
 * точке линии, а длина участка считается как разность накопленных расстояний.
 *
 * Притягивание считается в локальной равнопромежуточной проекции (долгота
 * сжимается на косинус широты) — на масштабах перегона искажение пренебрежимо,
 * и для выбора ближайшей точки этого достаточно. Сами расстояния при этом
 * берутся хаверсинусом по исходным координатам, без всякой проекции: где нужна
 * точность, приближение не используется.
 */
export interface RouteRuler {
  points: GeoPoint[];
  /** Накопленное расстояние от начала трассы до каждой вершины, км. */
  cumulativeKm: number[];
  totalKm: number;
}

export interface RoutePosition {
  /** Расстояние от начала трассы, км. */
  distanceKm: number;
  /** Точка на линии — та, к которой притянулся клик. */
  point: GeoPoint;
  /** Насколько далеко от трассы кликнули, км. По нему отсекаются промахи. */
  offsetKm: number;
}

export function createRouteRuler(points: GeoPoint[]): RouteRuler {
  const valid = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  const cumulativeKm: number[] = [];
  let total = 0;

  valid.forEach((point, index) => {
    if (index > 0) {
      total += haversineDistanceKm(valid[index - 1], point);
    }

    cumulativeKm.push(total);
  });

  return { points: valid, cumulativeKm, totalKm: total };
}

/**
 * Линейка, согласованная с длинами сегментов из ПЗ1.
 *
 * Кривая рисуется ломаной, и сумма её звеньев по хаверсинусу не совпадает с
 * длиной дуги, которую ПЗ1 считает аналитически: расхождение около четверти
 * процента, на маршруте в тысячу километров — несколько километров. Для ПЗ3
 * это не мелочь: студент сверяет сумму намеренного с длиной маршрута из ПЗ1 и
 * при идеальном замере всё равно получал бы расхождение.
 *
 * Поэтому расстояния внутри сегмента раскладываются пропорционально ломаной, а
 * сам сегмент получает ровно ту длину, которую даёт ПЗ1. Линейка меряет по
 * трассе, а итог сходится с эталоном.
 */
export function createRouteRulerFromSegments(segments: { points: GeoPoint[]; lengthKm: number }[]): RouteRuler {
  const points: GeoPoint[] = [];
  const cumulativeKm: number[] = [];
  let total = 0;

  for (const segment of segments) {
    const valid = segment.points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));

    if (valid.length === 0) {
      continue;
    }

    const chords = valid.slice(1).map((point, index) => haversineDistanceKm(valid[index], point));
    const polylineKm = chords.reduce((sum, chord) => sum + chord, 0);
    // Сегмент нулевой длины (точки совпали) делить не на что: он просто не
    // добавляет расстояния, но точку сохраняет.
    const scale = polylineKm > 0 ? segment.lengthKm / polylineKm : 0;
    const segmentStart = total;

    if (points.length === 0) {
      points.push(valid[0]);
      cumulativeKm.push(segmentStart);
    }

    let walked = 0;

    chords.forEach((chord, index) => {
      walked += chord;
      points.push(valid[index + 1]);
      cumulativeKm.push(segmentStart + walked * scale);
    });

    total = segmentStart + segment.lengthKm;
  }

  return { points, cumulativeKm, totalKm: total };
}

/** Ближайшая к точке отметка на трассе. null — если мерить не по чему. */
export function projectOntoRoute(ruler: RouteRuler, target: GeoPoint): RoutePosition | null {
  if (ruler.points.length === 0) {
    return null;
  }

  if (ruler.points.length === 1) {
    return { distanceKm: 0, offsetKm: haversineDistanceKm(ruler.points[0], target), point: ruler.points[0] };
  }

  let best: RoutePosition | null = null;
  let bestSquaredDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < ruler.points.length; index += 1) {
    const from = ruler.points[index - 1];
    const to = ruler.points[index];
    const ratio = segmentProjectionRatio(from, to, target);
    const point: GeoPoint = {
      lat: from.lat + (to.lat - from.lat) * ratio,
      lon: from.lon + (to.lon - from.lon) * ratio,
    };
    const squaredDistance = flatSquaredDistance(point, target);

    if (squaredDistance < bestSquaredDistance) {
      bestSquaredDistance = squaredDistance;
      best = {
        distanceKm: ruler.cumulativeKm[index - 1] + haversineDistanceKm(from, point),
        offsetKm: haversineDistanceKm(point, target),
        point,
      };
    }
  }

  return best;
}

/** Точка на трассе в заданном расстоянии от начала. */
export function pointAtDistance(ruler: RouteRuler, distanceKm: number): GeoPoint | null {
  if (ruler.points.length === 0) {
    return null;
  }

  const clamped = Math.min(Math.max(distanceKm, 0), ruler.totalKm);

  for (let index = 1; index < ruler.points.length; index += 1) {
    const spanStart = ruler.cumulativeKm[index - 1];
    const spanEnd = ruler.cumulativeKm[index];

    if (clamped <= spanEnd) {
      const spanLength = spanEnd - spanStart;
      const ratio = spanLength > 0 ? (clamped - spanStart) / spanLength : 0;
      const from = ruler.points[index - 1];
      const to = ruler.points[index];

      return {
        lat: from.lat + (to.lat - from.lat) * ratio,
        lon: from.lon + (to.lon - from.lon) * ratio,
      };
    }
  }

  return ruler.points[ruler.points.length - 1];
}

/** Длина участка между двумя отметками. Порядок отметок значения не имеет. */
export function measureRouteSpanKm(from: RoutePosition, to: RoutePosition): number {
  return Math.abs(to.distanceKm - from.distanceKm);
}

/**
 * Доля отрезка, на которую проецируется точка: 0 — начало, 1 — конец.
 * Значения за пределами обрезаются, чтобы проекция не улетала за отрезок.
 */
function segmentProjectionRatio(from: GeoPoint, to: GeoPoint, target: GeoPoint): number {
  const scale = longitudeScale(from.lat);
  const segmentLon = (to.lon - from.lon) * scale;
  const segmentLat = to.lat - from.lat;
  const targetLon = (target.lon - from.lon) * scale;
  const targetLat = target.lat - from.lat;
  const squaredLength = segmentLon * segmentLon + segmentLat * segmentLat;

  if (squaredLength === 0) {
    return 0;
  }

  const ratio = (targetLon * segmentLon + targetLat * segmentLat) / squaredLength;

  return Math.min(Math.max(ratio, 0), 1);
}

function flatSquaredDistance(left: GeoPoint, right: GeoPoint): number {
  const scale = longitudeScale(left.lat);
  const deltaLon = (right.lon - left.lon) * scale;
  const deltaLat = right.lat - left.lat;

  return deltaLon * deltaLon + deltaLat * deltaLat;
}

function longitudeScale(latitude: number): number {
  return Math.cos((latitude * Math.PI) / 180);
}
