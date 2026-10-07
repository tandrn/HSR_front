import type { MutableRefObject } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Снимок карты для PDF: подложка с тайлами и всё, что нарисовано поверх неё, —
 * в одной картинке и в одной проекции.
 *
 * Раньше в отчёт уходил голый снимок GL-канвы, а трассу и метки PDF дорисовывал
 * поверх собственной линейной проекцией «долгота/широта → прямоугольник». С
 * веб-меркатором она не совпадает, и линия ложилась мимо. Здесь всё поверх
 * тайлов проецируется тем же map.project(), что и сама карта, — совпадение по
 * построению, дорисовывать в отчёте нечего.
 *
 * Линии и метки рисуются вручную, а не берутся из GL-снимка: маркеры MapLibre
 * держит DOM-элементами поверх канвы, а линия слоя в сохранённый кадр буфера
 * попадает не всегда. Ручная отрисовка не зависит от того, какой кадр GL успел
 * оставить в буфере.
 *
 * Модуль общий для ПЗ1 и ПЗ2: снимок в обоих отчётах должен выглядеть одинаково,
 * а расходятся задания только тем, что именно рисуется поверх подложки.
 */

/** Точка на снимке, пикселей от левого верхнего угла. */
export interface PreviewPoint {
  x: number;
  y: number;
}

/**
 * Холст снимка вместе с проекцией карты.
 *
 * Рисующая сторона работает в тех же единицах, что и экран: холст уже переведён
 * в масштаб CSS-пикселей, поэтому радиус метки и толщина линии задаются такими
 * же числами, как в вёрстке, а разрешение снимка от этого не страдает.
 */
export interface PreviewCanvas {
  context: CanvasRenderingContext2D;
  /** Долгота и широта → точка на снимке, в проекции самой карты. */
  project: (coordinates: [number, number]) => PreviewPoint;
}

export type PreviewPainter = (canvas: PreviewCanvas) => void;

export interface PreviewOptions {
  paint: PreviewPainter;
  /**
   * Точки, которые обязаны попасть в кадр, — трасса, станции, значки.
   *
   * По ним снимок обрезается до нарисованного. Без обрезки широкая карточка
   * карты давала снимок, у которого трасса занимала узкую полосу посередине,
   * а остальное было пустой подложкой: в отчёте это выглядело как пустая
   * страница с точкой. Обрезка идёт по содержимому, поэтому ничего из
   * нарисованного не срезается — в отличие от обрезки под фиксированный кадр.
   */
  focus?: [number, number][];
}

/** Максимальная ширина снимка — чтобы PNG в JSON-мосте не разрастался
 *  на экранах с большим devicePixelRatio. */
const PREVIEW_MAX_WIDTH = 1200;
/* Пропорции снимка зажимаются в разумные рамки: слишком узкий кадр в отчёте
   становится полоской, слишком высокий — занимает страницу целиком. Короткая
   сторона кадра при этом расширяется, а не подрезается: расширение добавляет
   к снимку соседнюю карту, подрезка выбросила бы часть нарисованного. */
const PREVIEW_MIN_ASPECT = 1.4;
const PREVIEW_MAX_ASPECT = 2;
/** Поля вокруг нарисованного, CSS-пикселей: метка у самого края читается плохо. */
const PREVIEW_PADDING = 28;
/** Пауза перед снимком: за это время карта успевает дорисовать кадр. */
const PREVIEW_DELAY_MS = 300;

/**
 * Отложенный снимок карты. Вызовы, пришедшие подряд, схлопываются в один:
 * карта меняется на каждый ввод, а снимать её на каждое движение — это
 * несколько мегабайт PNG в секунду.
 */
export function schedulePreviewCapture(
  map: MapLibreMap,
  timerRef: MutableRefObject<number | null>,
  options: PreviewOptions,
  onPreviewImage: (previewImage: string) => void,
): void {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current);
  }

  timerRef.current = window.setTimeout(() => {
    try {
      const preview = captureMapPreview(map, options);

      if (preview) {
        onPreviewImage(preview);
      }
    } catch {
      // Канва испорчена сторонними тайлами без CORS — оставляем прошлый снимок.
    }
  }, PREVIEW_DELAY_MS);
}

/**
 * Немедленный снимок вместо отложенного.
 *
 * Нужен при закрытии карты: если студент нажал «Далее» сразу после правки,
 * отложенный снимок сработал бы уже на удалённой карте, ничего не снял бы, и
 * в отчёт ушёл бы кадр до последней правки.
 */
export function flushPreviewCapture(
  map: MapLibreMap,
  timerRef: MutableRefObject<number | null>,
  options: PreviewOptions,
  onPreviewImage: (previewImage: string) => void,
): void {
  if (timerRef.current === null) {
    return;
  }

  window.clearTimeout(timerRef.current);
  timerRef.current = null;

  try {
    const preview = captureMapPreview(map, options);

    if (preview) {
      onPreviewImage(preview);
    }
  } catch {
    // Канва испорчена сторонними тайлами без CORS — оставляем прошлый снимок.
  }
}

export function captureMapPreview(map: MapLibreMap, { paint, focus = [] }: PreviewOptions): string | null {
  const source = map.getCanvas();

  if (source.width === 0 || source.height === 0) {
    return null;
  }

  // Кадр собирается в разрешении самой канвы, а рисование идёт в CSS-пикселях:
  // на экране с двойной плотностью снимок остаётся чётким, а метки не
  // уменьшаются вдвое.
  //
  // Плотность спрашиваем у самой карты, а не считаем как «пиксели канвы на
  // ширину элемента»: при закрытии экрана карта уже без вёрстки, её ширина на
  // странице — ноль, и такое деление давало бесконечность, а за ней кадр из
  // NaN и пустая картинка в отчёте.
  const pixelRatio = normalizeRatio(map.getPixelRatio());
  const frame = document.createElement('canvas');
  frame.width = source.width;
  frame.height = source.height;

  const frameContext = frame.getContext('2d');
  if (!frameContext) {
    return null;
  }

  frameContext.drawImage(source, 0, 0);
  frameContext.save();
  frameContext.scale(pixelRatio, pixelRatio);
  paint({ context: frameContext, project: (coordinates) => map.project(coordinates) });
  frameContext.restore();

  const crop = getPreviewCrop(map, focus, frame.width, frame.height, pixelRatio);
  const targetWidth = Math.round(Math.min(crop.width, PREVIEW_MAX_WIDTH));
  const targetHeight = Math.round((crop.height * targetWidth) / crop.width);

  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth < 1 || targetHeight < 1) {
    return null;
  }

  const target = document.createElement('canvas');
  target.width = targetWidth;
  target.height = targetHeight;

  const context = target.getContext('2d');
  if (!context) {
    return null;
  }

  context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, 0, 0, targetWidth, targetHeight);

  return target.toDataURL('image/png');
}

/**
 * Кусок кадра, который уходит в отчёт: нарисованное с полями, вписанное в
 * допустимые пропорции и в границы самого кадра.
 */
function getPreviewCrop(
  map: MapLibreMap,
  focus: [number, number][],
  frameWidth: number,
  frameHeight: number,
  pixelRatio: number,
) {
  return computePreviewCrop(
    focus.map((coordinates) => map.project(coordinates)),
    { width: frameWidth, height: frameHeight },
    pixelRatio,
  );
}

/**
 * То же самое, но без карты: точки уже спроецированы в CSS-пиксели.
 * Отделено ради проверки — геометрия кадра тестируется без браузера.
 */
export function computePreviewCrop(
  points: PreviewPoint[],
  frame: { width: number; height: number },
  pixelRatio: number,
) {
  const whole = { x: 0, y: 0, width: frame.width, height: frame.height };
  const visible = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (visible.length === 0) {
    return fitAspect(whole, frame.width, frame.height);
  }

  const padding = PREVIEW_PADDING * pixelRatio;
  // Границы считаются перебором, а не Math.min(...points): трасса после
  // разбивки кривых — это десятки тысяч точек, и такой вызов падает по глубине
  // стека вызовов.
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;

  for (const point of visible) {
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }

  left = left * pixelRatio - padding;
  right = right * pixelRatio + padding;
  top = top * pixelRatio - padding;
  bottom = bottom * pixelRatio + padding;

  const box = {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: Math.min(frame.width, right) - Math.max(0, left),
    height: Math.min(frame.height, bottom) - Math.max(0, top),
  };

  if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width < 1 || box.height < 1) {
    return fitAspect(whole, frame.width, frame.height);
  }

  return fitAspect(box, frame.width, frame.height);
}

/** Расширяет кусок кадра до допустимых пропорций, не выходя за сам кадр. */
function fitAspect(
  box: { x: number; y: number; width: number; height: number },
  frameWidth: number,
  frameHeight: number,
) {
  let { x, y, width, height } = box;
  const aspect = width / height;

  if (aspect < PREVIEW_MIN_ASPECT) {
    width = Math.min(frameWidth, height * PREVIEW_MIN_ASPECT);
    x = clamp(x - (width - box.width) / 2, 0, frameWidth - width);
  } else if (aspect > PREVIEW_MAX_ASPECT) {
    height = Math.min(frameHeight, width / PREVIEW_MAX_ASPECT);
    y = clamp(y - (height - box.height) / 2, 0, frameHeight - height);
  }

  return { x, y, width, height };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Линия поверх подложки. Белая подложка под цветом обязательна: на пёстрых
 * тайлах красная трасса без неё теряется среди дорог такого же цвета.
 */
export function drawPreviewLine(
  context: CanvasRenderingContext2D,
  points: PreviewPoint[],
  options: { color: string; width: number; haloWidth?: number },
) {
  if (points.length < 2) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (options.haloWidth) {
    context.strokeStyle = '#ffffff';
    context.lineWidth = options.haloWidth;
    context.stroke();
  }

  context.strokeStyle = options.color;
  context.lineWidth = options.width;
  context.stroke();
}

/** Кружок метки с подписью — станция, точка трассы. */
export function drawPreviewBadge(
  context: CanvasRenderingContext2D,
  point: PreviewPoint,
  options: { label: string; radius: number; color: string; fontSize?: number },
) {
  drawPreviewDisc(context, point, options.radius, options.color);

  context.fillStyle = '#ffffff';
  context.font = `800 ${options.fontSize ?? 14}px Raleway, Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(options.label, point.x, point.y + 1);
}

/**
 * Кружок со значком вместо подписи. Контуры те же, что у маркера на карте и
 * у легенды в отчёте: значок задан один раз и рисуется всюду одинаково.
 */
export function drawPreviewIcon(
  context: CanvasRenderingContext2D,
  point: PreviewPoint,
  options: { paths: string[]; gridSize: number; strokeWidth: number; radius: number; color: string; countLabel?: string },
) {
  drawPreviewDisc(context, point, options.radius, options.color);

  // Значок вписывается в квадрат, вписанный в кружок, — иначе контуры лезут
  // на белую обводку.
  const iconSize = options.radius * (options.countLabel ? 1.05 : 1.45);
  const scale = iconSize / options.gridSize;

  context.save();
  context.translate(point.x - iconSize / 2, point.y - iconSize / 2 - (options.countLabel ? 4 : 0));
  context.scale(scale, scale);
  context.strokeStyle = '#ffffff';
  context.lineWidth = options.strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (const definition of options.paths) {
    context.stroke(new Path2D(definition));
  }

  context.restore();

  if (options.countLabel) {
    context.save();
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = 'bold 9px sans-serif';
    context.fillText(options.countLabel, point.x, point.y + options.radius * 0.56);
    context.restore();
  }
}

/** Плотность пикселей: только конечное положительное число имеет смысл. */
function normalizeRatio(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function drawPreviewDisc(context: CanvasRenderingContext2D, point: PreviewPoint, radius: number, color: string) {
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.lineWidth = 3;
  context.strokeStyle = '#ffffff';
  context.stroke();
}
