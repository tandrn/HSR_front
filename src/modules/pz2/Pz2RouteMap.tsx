import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker } from 'maplibre-gl';
import '../../shared/lib/maplibreWorker';
import { haversineDistanceKm } from '../../shared/lib/routeGeometry';
import { pointAtDistance, projectOntoRoute } from '../../shared/lib/routeRuler';
import {
  drawPreviewBadge,
  drawPreviewIcon,
  drawPreviewLine,
  flushPreviewCapture,
  schedulePreviewCapture,
} from '../../shared/lib/mapPreview';
import type { PreviewOptions } from '../../shared/lib/mapPreview';
import type { RouteRuler } from '../../shared/lib/routeRuler';
import { formatPz2Km } from './model';
import { PZ2_ICON_GRID, PZ2_ICON_STROKE, getPz2WorkIcon } from './workIcons';
import type {
  Pz2RoutePointMark,
  Pz2RouteSpan,
  Pz2SegmentMark,
  Pz2StageSpanGroup,
  Pz2StationMark,
  Pz2WorkKind,
  Pz2WorkMark,
} from './types';

/**
 * Цвета те же, что в ПЗ1: трасса ВСМ красная (--color-route-hsr), а бирюзовый
 * (--teal) в макете означает «выбранное сейчас» — им и показываем отмеренный
 * участок. Раньше трасса здесь была синей, и одна и та же линия выглядела в
 * двух заданиях по-разному.
 */
const ROUTE_COLOR = '#e0182d';
const SPAN_COLOR = '#08a696';
/** Станция — синяя, как в ПЗ1; цвета работ хранятся рядом с их значками. */
const STATION_COLOR = '#003d84';

/** Значки маркеров рисуются как SVG-узлы, а те живут в своём пространстве имён. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Пустые значения по умолчанию заведены один раз.
 *
 * Литерал `[]` в параметрах создавал бы новый массив на каждый рендер, а он
 * стоит в зависимостях эффекта, который перекладывает слои карты: эффект
 * срабатывал на каждое нажатие клавиши в таблице работ и пересобирал geojson
 * всей трассы.
 */
const NO_WORK_MARKS: Pz2WorkMark[] = [];
const NO_STAGE_SPANS: Pz2StageSpanGroup[] = [];

const ROUTE_SOURCE_ID = 'pz2-route';
const ROUTE_LAYER_ID = 'pz2-route-line';
const SPAN_SOURCE_ID = 'pz2-span';
const SPAN_LAYER_ID = 'pz2-span-line';
const MARK_SOURCE_ID = 'pz2-marks';
const MARK_LAYER_ID = 'pz2-marks-points';
const STAGE_SOURCE_ID = 'pz2-stages';
const STAGE_LAYER_ID = 'pz2-stages-line';
/** Поля вокруг вписанной трассы, пикселей. */
const ROUTE_PADDING_PX = 36;
/** Сколько тайлов должно не загрузиться, прежде чем говорить о проблеме. */
const TILE_ERRORS_BEFORE_NOTICE = 3;
/** К отметке ближе этого числа пикселей клик притягивается «магнитом». */
const MAGNET_PX = 14;
/** Допустимый промах мимо линии — доля длины трассы. */
const SNAP_LIMIT_SHARE = 0.05;
const SNAP_LIMIT_MIN_KM = 2;

interface Pz2RouteMapProps {
  ruler: RouteRuler;
  /** Станции из ПЗ1 с километражом — ориентиры, между которыми меряют участки. */
  stations: Pz2StationMark[];
  /** Точки линии, которые студент ставил в ПЗ1: та же трасса, те же номера. */
  routePoints: Pz2RoutePointMark[];
  /** Прямые вставки и кривые из ПЗ1 — справочно, менять их здесь нельзя. */
  segments: Pz2SegmentMark[];
  /** Объекты на трассе с их значками. */
  workMarks?: Pz2WorkMark[];
  /** Перестановка объекта без намеренного участка вдоль трассы. */
  onWorkPositionChange?: (workId: string, distanceKm: number) => void;
  /**
   * Куски трассы по этапам — раскраска для экрана 02. Линейка там не нужна:
   * трасса уже размечена, этот экран только распределяет работы.
   */
  stageSpans?: Pz2StageSpanGroup[];
  /** Этап, на который навели: остальные приглушаются. */
  highlightedStageId?: string;
  /** Показывать линейку и переключатель режимов. */
  withRuler?: boolean;
  /** Отметки линейки, км от начала трассы. Одна отметка — измерение начато. */
  marksKm: number[];
  onMarksChange: (marksKm: number[]) => void;
  /** Участок измерен: две отметки поставлены. */
  onMeasured: (lengthKm: number, span: Pz2RouteSpan) => void;
  /** Участок строки, на которую навели в таблице: показываем вместо текущих отметок. */
  highlightedSpan?: Pz2RouteSpan | null;
  /**
   * Снимок карты для отчёта. Карта в ПЗ2 — главное, что студент делает руками,
   * и отчёт без неё не показывает, где на трассе стоят работы.
   */
  onPreviewImageChange?: (previewImage: string) => void;
}

/**
 * Карта трассы из ПЗ1 с линейкой.
 *
 * Мерить нужно вдоль линии, а не по прямой между кликами, поэтому клик
 * притягивается к ближайшей точке трассы, а длина участка берётся как разность
 * расстояний от начала. Так сумма участков сходится с длиной маршрута — на этом
 * держится проверка длины на шаге.
 */
export function Pz2RouteMap({
  ruler,
  stations,
  routePoints,
  segments,
  workMarks = NO_WORK_MARKS,
  marksKm,
  highlightedSpan = null,
  stageSpans = NO_STAGE_SPANS,
  highlightedStageId = '',
  withRuler = true,
  onMarksChange,
  onMeasured,
  onPreviewImageChange,
  onWorkPositionChange,
}: Pz2RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const rulerRef = useRef(ruler);
  const marksRef = useRef(marksKm);
  const onMarksChangeRef = useRef(onMarksChange);
  const onMeasuredRef = useRef(onMeasured);
  const onWorkPositionChangeRef = useRef(onWorkPositionChange);
  const onPreviewImageChangeRef = useRef(onPreviewImageChange);
  const previewOptionsRef = useRef<PreviewOptions>({ paint: () => undefined });
  const previewTimerRef = useRef<number | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [hoverKm, setHoverKm] = useState<number | null>(null);
  const [missedClick, setMissedClick] = useState(false);
  /** Экранная точка первой отметки — у неё висит накопленная длина. */
  const [markPoint, setMarkPoint] = useState<{ x: number; y: number } | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [mode, setMode] = useState<'view' | 'ruler'>(withRuler ? 'ruler' : 'view');
  const modeRef = useRef(mode);
  const anchorsRef = useRef<number[]>([]);
  const syncMarkPointRef = useRef<(() => void) | null>(null);
  const tileErrorsRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
    // Опорные километры: концы трассы, её точки и станции — то, по чему студент
    // и режет участки. К ним клик притягивается, иначе точный замер невозможен.
    anchorsRef.current = [
      0,
      ruler.totalKm,
      ...routePoints.map((point) => point.distanceKm),
      ...stations.map((station) => station.distanceKm),
    ];
    rulerRef.current = ruler;
    marksRef.current = marksKm;
    onMarksChangeRef.current = onMarksChange;
    onMeasuredRef.current = onMeasured;
    onWorkPositionChangeRef.current = onWorkPositionChange;
    onPreviewImageChangeRef.current = onPreviewImageChange;
    // Снимок делается отложенно, уже после этого рендера: что рисовать и что
    // обязано попасть в кадр, берётся из ссылки — чтобы снялось то, что на
    // карте сейчас.
    previewOptionsRef.current = createPreviewOptions({ ruler, stations, routePoints, workMarks, stageSpans });
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current || ruler.points.length === 0) {
      return undefined;
    }

    const map = new maplibregl.Map({
      attributionControl: false,
      // Вид считает сама MapLibre по реальному размеру контейнера: расчётный
      // зум по предполагаемым размерам карточки промахивался, и трасса
      // уезжала за верхний край карты.
      bounds: routeBounds(ruler, [...stations, ...routePoints]),
      fitBoundsOptions: { padding: ROUTE_PADDING_PX, animate: false },
      container: containerRef.current,
      canvasContextAttributes: { contextType: 'webgl2', preserveDrawingBuffer: true },
      maxZoom: 19,
      minZoom: 3,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
      },
    });

    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      ensureLayers(map);
      setIsMapReady(true);
    });

    // Подложка приходит с tile.openstreetmap.org, и в закрытой сети её может
    // не быть. Молча показывать пустое поле нельзя: студент решит, что сломано
    // всё задание, хотя трасса и линейка считаются на своих данных.
    map.on('error', (event) => {
      if (!isTileError(event.error)) {
        return;
      }

      tileErrorsRef.current += 1;

      if (tileErrorsRef.current >= TILE_ERRORS_BEFORE_NOTICE) {
        setTilesFailed(true);
      }
    });

    map.on('mousemove', (event: MapMouseEvent) => {
      const position = projectOntoRoute(rulerRef.current, { lat: event.lngLat.lat, lon: event.lngLat.lng });
      const onRoute =
        modeRef.current === 'ruler' && position !== null && position.offsetKm <= snapLimitKm(rulerRef.current);
      setHoverKm(onRoute ? (magnetTargetKm(map, anchorsRef.current, position.distanceKm) ?? position.distanceKm) : null);
      map.getCanvas().style.cursor = onRoute ? 'crosshair' : '';
    });

    map.on('mouseout', () => setHoverKm(null));

    // Тайлы приезжают асинхронно, и снимок, сделанный сразу после отрисовки
    // слоёв, вышел бы без подложки. «idle» — это кадр, в котором карта дорисовала
    // всё, что могла: снимаем по нему, а не по таймеру от последнего изменения.
    map.on('idle', () => capturePreview(map));

    const syncMarkPoint = () => {
      const [firstKm] = marksRef.current;
      const point = firstKm === undefined ? null : pointAtDistance(rulerRef.current, firstKm);
      const projected = point ? map.project([point.lon, point.lat]) : null;

      // Новый объект на каждый вызов сбрасывал бы состояние вхолостую, а вызов
      // идёт в том же эффекте, что рисует слои, — получался бесконечный круг
      // «эффект → состояние → рендер → эффект». Меняем, только когда сдвинулось.
      setMarkPoint((previous) => {
        if (!projected) {
          return previous === null ? previous : null;
        }

        if (previous && Math.abs(previous.x - projected.x) < 0.5 && Math.abs(previous.y - projected.y) < 0.5) {
          return previous;
        }

        return { x: projected.x, y: projected.y };
      });
    };

    map.on('move', syncMarkPoint);
    map.on('zoom', syncMarkPoint);
    map.on('resize', syncMarkPoint);
    syncMarkPointRef.current = syncMarkPoint;

    map.on('click', (event: MapMouseEvent) => {
      if (modeRef.current !== 'ruler') {
        return;
      }

      const position = projectOntoRoute(rulerRef.current, { lat: event.lngLat.lat, lon: event.lngLat.lng });

      // Клик далеко от линии — это промах, а не отметка: без порога любая точка
      // карты притягивалась к трассе и молча становилась границей участка.
      if (!position || position.offsetKm > snapLimitKm(rulerRef.current)) {
        setMissedClick(true);
        return;
      }

      setMissedClick(false);
      const magnetKm = magnetTargetKm(map, anchorsRef.current, position.distanceKm);
      const distanceKm = magnetKm ?? position.distanceKm;
      const current = marksRef.current;

      // Первый клик открывает измерение, второй — закрывает и отдаёт длину.
      if (current.length !== 1) {
        onMarksChangeRef.current([distanceKm]);
        return;
      }

      const lengthKm = Math.abs(distanceKm - current[0]);
      onMarksChangeRef.current([current[0], distanceKm]);
      onMeasuredRef.current(lengthKm, { fromKm: current[0], toKm: distanceKm });
    });

    return () => {
      const onPreview = onPreviewImageChangeRef.current;

      if (onPreview) {
        // Отложенный снимок делаем сейчас: карта вот-вот исчезнет, и снимать
        // будет нечего, а в отчёт уйдёт кадр до последней правки.
        flushPreviewCapture(map, previewTimerRef, previewOptionsRef.current, onPreview);
      }

      map.remove();
      mapRef.current = null;
      setIsMapReady(false);
    };
  }, [ruler.points.length]);

  /**
   * Снимок карты для отчёта.
   *
   * Функция замкнута только на ссылки, поэтому её можно звать и из обработчиков
   * карты, заведённых один раз при создании. Повторный снимок того же вида даёт
   * тот же PNG, а родитель сравнивает строку и не трогает черновик, если она не
   * изменилась, — лишнего круга «снимок → перерисовка → снимок» не выходит.
   */
  function capturePreview(map: MapLibreMap) {
    const onPreview = onPreviewImageChangeRef.current;

    if (!onPreview) {
      return;
    }

    schedulePreviewCapture(map, previewTimerRef, previewOptionsRef.current, onPreview);
  }

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isMapReady) {
      return;
    }

    setGeoJson(map, ROUTE_SOURCE_ID, lineFeature(ruler.points.map((point) => [point.lon, point.lat])));

    const shownMarks = highlightedSpan ? [highlightedSpan.fromKm, highlightedSpan.toKm] : marksKm;
    const markPoints = shownMarks
      .map((distanceKm) => pointAtDistance(ruler, distanceKm))
      .filter((point): point is NonNullable<typeof point> => point !== null);
    setGeoJson(map, MARK_SOURCE_ID, pointFeatures(markPoints.map((point) => [point.lon, point.lat])));

    const span = shownMarks.length === 2 ? sliceRoute(ruler, shownMarks[0], shownMarks[1]) : [];
    setGeoJson(map, SPAN_SOURCE_ID, lineFeature(span.map((point) => [point.lon, point.lat])));
    setGeoJson(map, STAGE_SOURCE_ID, stageFeatures(ruler, stageSpans, highlightedStageId));
    syncMarkPointRef.current?.();
    capturePreview(map);
  }, [highlightedSpan, highlightedStageId, isMapReady, marksKm, ruler, stageSpans, workMarks]);

  useEffect(() => {
    // Esc → «Просмотр»: та же механика, что в ПЗ1 (ТЗ v3.5 §3 П-04), ТЗ ПЗ2 §5.1
    // требует её здесь же, поэтому поведение повторяется дословно.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMode('view');
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isMapReady) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [
      // Точки линии рисуем первыми: где станция стоит на точке, сверху должна
      // оказаться станция — она крупнее и важнее как ориентир.
      ...routePoints.map((point) =>
        createMarker(
          map,
          [point.lon, point.lat],
          'maplibre-marker--route',
          String(point.number),
          `Точка трассы ${point.number} — ${formatPz2Km(point.distanceKm)} от начала`,
        ),
      ),
      ...workMarks.flatMap((mark) => {
        const point = pointAtDistance(ruler, mark.distanceKm);

        return point ? [createWorkMarker(map, [point.lon, point.lat], mark, onWorkPositionChangeRef, rulerRef)] : [];
      }),
      ...stations.map((station) =>
        createMarker(
          map,
          [station.lon, station.lat],
          'maplibre-marker--station',
          station.label,
          `Станция ${station.label}${station.name ? `: ${station.name}` : ''} — ${formatPz2Km(station.distanceKm)} от начала трассы`,
        ),
      ),
    ];

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
    };
  }, [isMapReady, routePoints, stations, workMarks, ruler]);

  if (ruler.points.length === 0) {
    return (
      <section className="osm-map-card" aria-label="Карта трассы">
        <div className="osm-map-card__head">
          <div>
            <p className="eyebrow">Карта трассы</p>
            <h3>Трасса не загружена</h3>
          </div>
        </div>
        <div className="map-placeholder">
          <p>Загрузите на интро файл, сохранённый в ПЗ1, — карта и длина маршрута берутся из него.</p>
        </div>
      </section>
    );
  }

  const workLegend = getWorkLegend(workMarks);
  const measuringKm = marksKm.length === 1 && hoverKm !== null ? Math.abs(hoverKm - marksKm[0]) : null;
  const highlightedKm = highlightedSpan ? Math.abs(highlightedSpan.toKm - highlightedSpan.fromKm) : null;

  return (
    <section
      className="osm-map-card"
      aria-label={withRuler ? 'Карта трассы с линейкой' : 'Карта трассы с этапами'}
    >
      <div className="osm-map-card__head">
        <div>
          <p className="eyebrow">{withRuler ? 'Линейка' : 'Трасса'}</p>
          <h3>{withRuler ? 'Измерение участка' : 'Этапы на трассе'}</h3>
        </div>
        {withRuler ? (
          <div className="osm-map-actions">
            <div className="segmented-control segmented-control--map-tools" aria-label="Режим карты">
              <button className={mode === 'view' ? 'is-active' : ''} onClick={() => setMode('view')} type="button">
                Просмотр
              </button>
              <button className={mode === 'ruler' ? 'is-active' : ''} onClick={() => setMode('ruler')} type="button">
                Линейка
              </button>
            </div>
            <button
              className="button button--outline"
              disabled={marksKm.length === 0}
              onClick={() => onMarksChange([])}
              type="button"
            >
              Сбросить отметки
            </button>
          </div>
        ) : null}
      </div>

      {tilesFailed ? (
        <p className="field-warning">
          Подложка карты не загрузилась: нет доступа к tile.openstreetmap.org. Трасса, станции и линейка работают —
          они считаются по файлу ПЗ1, — но фон карты будет пустым.
        </p>
      ) : null}

      <div className="osm-map-stage">
        <div className="maplibre-container" ref={containerRef} />
        {withRuler && mode === 'ruler' ? <p className="osm-map-esc-hint"><kbd>Esc</kbd> — вернуться к просмотру</p> : null}

        {/* Накопленная длина висит у поставленной отметки: во время замера
            студент следит именно за ней, и отправлять её в угол нельзя. */}
        {measuringKm !== null && markPoint ? (
          <span className="ruler-live" style={{ left: markPoint.x, top: markPoint.y }}>
            {formatPz2Km(measuringKm)}
          </span>
        ) : null}

        <div className="route-length-panel">
          <span>{panelLabel(highlightedKm, marksKm.length)}</span>
          <strong>{formatPz2Km(highlightedKm ?? measuringKm ?? ruler.totalKm)}</strong>
        </div>
      </div>

      {stations.length > 0 ? (
        <ul className="route-stations-legend">
          {/* Число рядом со станцией — её километр по трассе, а не расстояние по
              прямой и не длина участка. Без подписи оно читалось как загадка. */}
          <li className="route-stations-legend__caption">Станции, км от начала трассы:</li>
          {stations.map((station) => (
            <li key={station.label}>
              <span className="route-stations-legend__label">{station.label}</span>
              <span>{station.name || 'без названия'}</span>
              <strong>{formatPz2Km(station.distanceKm)}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {workLegend.length > 0 ? (
        <ul className="route-works-legend">
          <li className="route-works-legend__caption">Объекты на трассе:</li>
          {workLegend.map((item) => (
            <li key={item.kind}>
              <span className="route-works-legend__icon" style={{ backgroundColor: getPz2WorkIcon(item.kind)?.color }}>
                <WorkIconGlyph kind={item.kind} />
              </span>
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {segments.length > 0 ? (
        <details className="route-segments-summary">
          <summary>
            Сегменты трассы из ПЗ1: {segments.length} · кривых {segments.filter((item) => item.radiusM !== null).length}
          </summary>
          <ul>
            {segments.map((segment) => (
              <li key={segment.id}>
                <span>Сегмент {segment.number}</span>
                <span>{segment.radiusM === null ? 'прямая вставка' : `кривая R = ${segment.radiusM} м`}</span>
                <strong>{formatPz2Km(segment.lengthKm)}</strong>
                <span className="route-segments-summary__from">с {formatPz2Km(segment.fromKm)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="osm-map-hint">
        {!withRuler ? 'Цвет участка — цвет этапа. Наведите на этап, чтобы подсветить его на карте. ' : null}
        {withRuler && mode === 'view'
          ? 'Режим просмотра: карту можно двигать и приближать. Включите «Линейку», чтобы мерить. '
          : null}
        {withRuler && mode === 'ruler' && missedClick
          ? 'Мимо трассы. Кликните ближе к линии — отметка ставится только на ней. '
          : null}
        {!withRuler || mode === 'view' ? null : marksKm.length === 1
          ? 'Начало участка поставлено. Кликните второй раз — длина посчитается вдоль трассы и подставится в таблицу.'
          : 'Кликните на трассе, чтобы отметить начало участка, затем ещё раз — чтобы отметить конец. Рядом со станцией, точкой трассы или её концом отметка садится ровно на них.'}
        {withRuler && workMarks.some((mark) => mark.draggable)
          ? ' Значок объекта без отмеренного участка можно перетащить в нужное место трассы.'
          : null}
      </p>
    </section>
  );
}

/**
 * Насколько далеко от линии клик ещё считается попаданием.
 *
 * Порог берём от длины трассы, а не в километрах наотмашь: на трассе в 500 км
 * промах в пару километров — это попадание, а на коротком участке — уже нет.
 */
/** Ошибка загрузки тайла подложки — в отличие от ошибок стиля или слоёв. */
function isTileError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');

  return message.includes('tile.openstreetmap.org') || message.toLowerCase().includes('tile');
}

/**
 * Притягивание клика к ближайшей опорной точке.
 *
 * На общем виде маршрута один пиксель — это километры трассы, и попасть мышью
 * в конец участка нельзя в принципе: замер всей трассы расходился с эталоном на
 * пиксель клика. Поэтому рядом с концом трассы, точкой линии или станцией
 * отметка садится ровно на них. Порог задан в пикселях и переводится в
 * километры по текущему масштабу: на приближённой карте магнит слабее, и
 * мерить между опорными точками он не мешает.
 */
function magnetTargetKm(map: MapLibreMap, anchorsKm: number[], distanceKm: number): number | null {
  const thresholdKm = pixelsToKm(map, MAGNET_PX);
  let best: number | null = null;
  let bestDelta = thresholdKm;

  for (const anchorKm of anchorsKm) {
    const delta = Math.abs(anchorKm - distanceKm);

    if (delta <= bestDelta) {
      bestDelta = delta;
      best = anchorKm;
    }
  }

  return best;
}

/** Сколько километров трассы приходится на столько-то пикселей при текущем масштабе. */
function pixelsToKm(map: MapLibreMap, pixels: number) {
  const center = map.getCenter();
  const centerPoint = map.project(center);
  const shifted = map.unproject([centerPoint.x + pixels, centerPoint.y]);

  return haversineDistanceKm({ lat: center.lat, lon: center.lng }, { lat: shifted.lat, lon: shifted.lng });
}

function snapLimitKm(ruler: RouteRuler) {
  return Math.max(SNAP_LIMIT_MIN_KM, ruler.totalKm * SNAP_LIMIT_SHARE);
}

/** Вписываем трассу вместе со станциями и точками линии — они могут стоять чуть в стороне. */
function routeBounds(ruler: RouteRuler, marks: { lat: number; lon: number }[]): [number, number, number, number] {
  const points = [...ruler.points, ...marks];
  const lons = points.map((point) => point.lon);
  const lats = points.map((point) => point.lat);

  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** Маркер на карте: те же классы, что в ПЗ1, — трасса выглядит одинаково в обоих заданиях. */
function createMarker(map: MapLibreMap, lngLat: [number, number], modifier: string, label: string, title: string) {
  const element = document.createElement('span');
  element.className = `maplibre-marker ${modifier}`;
  element.textContent = label;
  element.title = title;

  return new maplibregl.Marker({ element }).setLngLat(lngLat).addTo(map);
}

/**
 * Маркер сооружения: вместо подписи — значок из общего словаря.
 *
 * Название («мост», «тоннель») в кружок размером с точку трассы не поместится,
 * а сокращать его до буквы значит заводить второй язык подписей. Значок
 * читается сразу, а полное название с километражом остаётся в подсказке.
 */
function createWorkMarker(
  map: MapLibreMap,
  lngLat: [number, number],
  mark: Pz2WorkMark,
  onPositionChangeRef: { current?: (workId: string, distanceKm: number) => void },
  rulerRef: { current: RouteRuler },
) {
  const icon = getPz2WorkIcon(mark.kind);
  const element = document.createElement('span');
  const draggable = Boolean(mark.draggable && onPositionChangeRef.current);
  element.className = `maplibre-marker maplibre-marker--work${mark.kind === 'turnout' ? ' maplibre-marker--turnout' : ''}${draggable ? ' is-draggable' : ''}`;
  element.title = mark.title;
  element.setAttribute('aria-label', mark.title);

  if (icon) {
    element.style.backgroundColor = icon.color;
  }

  if (icon) {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', `0 0 ${PZ2_ICON_GRID} ${PZ2_ICON_GRID}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    for (const definition of icon.paths) {
      const path = document.createElementNS(SVG_NAMESPACE, 'path');
      path.setAttribute('d', definition);
      svg.append(path);
    }

    element.append(svg);
  }

  if (mark.kind === 'turnout') {
    const count = document.createElement('span');
    count.className = 'maplibre-marker__count';
    count.textContent = String(mark.count ?? 0);
    element.append(count);
  }

  const marker = new maplibregl.Marker({ element, draggable }).setLngLat(lngLat).addTo(map);

  if (draggable) {
    marker.on('dragend', () => {
      const position = marker.getLngLat();
      const projected = projectOntoRoute(rulerRef.current, { lat: position.lat, lon: position.lng });

      if (!projected) {
        marker.setLngLat(lngLat);
        return;
      }

      const snapped = pointAtDistance(rulerRef.current, projected.distanceKm);

      if (snapped) {
        marker.setLngLat([snapped.lon, snapped.lat]);
      }

      onPositionChangeRef.current?.(mark.id, projected.distanceKm);
    });
  }

  return marker;
}

/**
 * Что попадает в снимок карты для отчёта: трасса, раскраска по этапам, точки
 * линии, значки сооружений и станции — ровно то, что видно на экране.
 *
 * Отметки линейки не рисуются: это незаконченное измерение, а не результат.
 * Порядок отрисовки тот же, что у маркеров: станция крупнее и важнее, поэтому
 * ложится поверх точки трассы, если они совпали.
 */
function createPreviewOptions({
  ruler,
  stations,
  routePoints,
  workMarks,
  stageSpans,
}: {
  ruler: RouteRuler;
  stations: Pz2StationMark[];
  routePoints: Pz2RoutePointMark[];
  workMarks: Pz2WorkMark[];
  stageSpans: Pz2StageSpanGroup[];
}): PreviewOptions {
  const paint: PreviewOptions['paint'] = ({ context, project }) => {
    const toPoint = (point: { lat: number; lon: number }) => project([point.lon, point.lat]);

    drawPreviewLine(context, ruler.points.map(toPoint), { color: ROUTE_COLOR, width: 5, haloWidth: 9 });

    for (const stage of stageSpans) {
      for (const span of stage.spans) {
        drawPreviewLine(context, sliceRoute(ruler, span.fromKm, span.toKm).map(toPoint), {
          color: stage.color,
          width: 6,
        });
      }
    }

    for (const point of routePoints) {
      drawPreviewBadge(context, toPoint(point), {
        label: String(point.number),
        radius: 9,
        color: ROUTE_COLOR,
        fontSize: 11,
      });
    }

    for (const mark of workMarks) {
      const point = pointAtDistance(ruler, mark.distanceKm);
      const icon = getPz2WorkIcon(mark.kind);

      if (!point || !icon) {
        continue;
      }

      drawPreviewIcon(context, toPoint(point), {
        paths: icon.paths,
        gridSize: PZ2_ICON_GRID,
        strokeWidth: PZ2_ICON_STROKE,
        radius: mark.kind === 'turnout' ? 14 : 11,
        color: icon.color,
        ...(mark.kind === 'turnout' ? { countLabel: String(mark.count ?? 0) } : {}),
      });
    }

    for (const station of stations) {
      drawPreviewBadge(context, toPoint(station), { label: station.label, radius: 12, color: STATION_COLOR });
    }
  };

  return {
    paint,
    // В кадр обязаны попасть трасса, станции и точки линии: снимок обрезается
    // по ним, а значки сооружений стоят на самой трассе и попадают следом.
    focus: [...ruler.points, ...stations, ...routePoints].map((point): [number, number] => [point.lon, point.lat]),
  };
}

/** Какие сооружения отмечены на карте и сколько их — расшифровка значков. */
function getWorkLegend(workMarks: Pz2WorkMark[]) {
  const counts = new Map<Pz2WorkKind, { kind: Pz2WorkKind; label: string; count: number }>();

  for (const mark of workMarks) {
    const item = counts.get(mark.kind);

    if (item) {
      item.count += mark.count ?? 1;
    } else {
      counts.set(mark.kind, { kind: mark.kind, label: mark.label, count: mark.count ?? 1 });
    }
  }

  return [...counts.values()];
}

/** Значок в вёрстке легенды — те же контуры, что и у маркера. */
function WorkIconGlyph({ kind }: { kind: Pz2WorkKind }) {
  const icon = getPz2WorkIcon(kind);

  if (!icon) {
    return null;
  }

  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${PZ2_ICON_GRID} ${PZ2_ICON_GRID}`}>
      {icon.paths.map((definition) => (
        <path d={definition} key={definition} />
      ))}
    </svg>
  );
}

function panelLabel(highlightedKm: number | null, markCount: number) {
  if (highlightedKm !== null) {
    return 'Участок строки';
  }

  return markCount === 1 ? 'Меряется' : 'Длина трассы';
}

function ensureLayers(map: MapLibreMap) {
  map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: lineFeature([]) });
  map.addLayer({
    id: ROUTE_LAYER_ID,
    type: 'line',
    source: ROUTE_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ROUTE_COLOR, 'line-width': 5, 'line-opacity': 0.9 },
  });

  map.addSource(SPAN_SOURCE_ID, { type: 'geojson', data: lineFeature([]) });
  map.addLayer({
    id: SPAN_LAYER_ID,
    type: 'line',
    source: SPAN_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': SPAN_COLOR, 'line-width': 8 },
  });

  map.addSource(STAGE_SOURCE_ID, { type: 'geojson', data: lineFeature([]) });
  map.addLayer({
    id: STAGE_LAYER_ID,
    type: 'line',
    source: STAGE_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    // Цвет и прозрачность приходят с самим куском: этапов сколько угодно, а слой
    // один — заводить слой на этап значило бы плодить их на каждый ввод.
    paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': ['get', 'opacity'] },
  });

  map.addSource(MARK_SOURCE_ID, { type: 'geojson', data: pointFeatures([]) });
  map.addLayer({
    id: MARK_LAYER_ID,
    type: 'circle',
    source: MARK_SOURCE_ID,
    paint: {
      'circle-radius': 7,
      'circle-color': SPAN_COLOR,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });
}

function setGeoJson(map: MapLibreMap, sourceId: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(sourceId);

  if (source) {
    (source as GeoJSONSource).setData(data);
  }
}

function lineFeature(coordinates: number[][]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features:
      coordinates.length >= 2
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }]
        : [],
  };
}

function pointFeatures(coordinates: number[][]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: coordinates.map((coordinate) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: coordinate },
    })),
  };
}

/** Куски трассы, занятые этапами: цвет и приглушение едут в самих кусках. */
function stageFeatures(
  ruler: RouteRuler,
  stageSpans: Pz2StageSpanGroup[],
  highlightedStageId: string,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: stageSpans.flatMap((stage) =>
      stage.spans.flatMap((span) => {
        const points = sliceRoute(ruler, span.fromKm, span.toKm);

        if (points.length < 2) {
          return [];
        }

        return [
          {
            type: 'Feature' as const,
            properties: {
              color: stage.color,
              opacity: highlightedStageId && highlightedStageId !== stage.id ? 0.25 : 0.9,
            },
            geometry: {
              type: 'LineString' as const,
              coordinates: points.map((point) => [point.lon, point.lat]),
            },
          },
        ];
      }),
    ),
  };
}

/** Кусок трассы между двумя отметками — его подсвечиваем красным. */
function sliceRoute(ruler: RouteRuler, fromKm: number, toKm: number) {
  const start = Math.min(fromKm, toKm);
  const end = Math.max(fromKm, toKm);
  const startPoint = pointAtDistance(ruler, start);
  const endPoint = pointAtDistance(ruler, end);

  if (!startPoint || !endPoint) {
    return [];
  }

  const inner = ruler.points.filter((_, index) => ruler.cumulativeKm[index] > start && ruler.cumulativeKm[index] < end);

  return [startPoint, ...inner, endPoint];
}
