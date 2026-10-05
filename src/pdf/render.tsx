import { Circle, Document, Font, Image, Page, Polyline, Svg, Text, View, pdf } from '@react-pdf/renderer';
import { downloadTextFile } from '../bridge/io';
import { KeyValueTable, PAGE_SIZE, PDF_MAP_HEIGHT, formatDate, formatRequiredValue, styles } from './common';
import type { GeoPoint, Pz1PassengerFlowResult, Pz1Result, RouteLine, TransportModeId } from '../bridge/schema';
import { correspondenceTravelTimeRows, finalIndicators, transportColumns } from '../modules/pz1/model';
import type { StationRouteDistance } from '../modules/pz1/model';
import { buildDisplayRoutePoints, computeRouteLineMetrics } from '../shared/lib/routeGeometry';
import { buildPassengerFlowStackedData, passengerFlowChartModes } from '../shared/lib/passengerFlowChart';

const PDF_MAP_WIDTH = 470;
const PDF_MAP_PADDING = 12;

interface PdfStation {
  label: string;
  name: string;
  lat: number;
  lng: number;
  type: 'terminal' | 'intermediate';
  region?: string;
}

interface PdfMapPoint {
  x: number;
  y: number;
}

interface PdfMapStationPoint extends PdfMapPoint {
  key: string;
}

interface PdfMapOverlay {
  routePoints: PdfMapPoint[];
  stationPoints: PdfMapStationPoint[];
}

export interface Pz1PdfSummary {
  team: string;
  lineTitle: string;
  variantTitle: string;
  stationCount: number;
  routePointCount: number;
  totalLengthKm: number;
  filledConsumerCells: number;
  runId: string;
  filledIndicatorCount: number;
  createdAt: string;
  correspondenceScenarios?: Pz1Result['correspondenceScenarios'];
  consumerProperties?: Pz1Result['consumerProperties'];
  discomfortMatrix?: Pz1Result['discomfortMatrix'];
  finalIndicators?: Pz1Result['finalIndicators'];
  hsrTravelTime?: Pz1Result['hsrTravelTime'];
  passengerFlowForecast?: Pz1PassengerFlowResult;
  regionalCharacteristics?: Pz1Result['regionalCharacteristics'];
  notes?: string;
  stations?: PdfStation[];
  routeLine?: RouteLine;
  stationRouteDistances?: StationRouteDistance[];
  previewImage?: string;
}

export interface Pz1PdfSection {
  title: string;
  rows: Array<[string, string]>;
}

Font.registerHyphenationCallback((word: string) => [word]);

export async function downloadPz1Pdf(summary: Pz1PdfSummary, fileName: string): Promise<void> {
  const blob = await createPz1PdfBlob(summary);
  downloadTextFile(fileName, 'application/pdf', await blob.arrayBuffer());
}

export async function createPz1PdfBlob(summary: Pz1PdfSummary): Promise<Blob> {
  return pdf(<Pz1ReportDocument summary={summary} />).toBlob();
}

export function createPz1PdfSections(summary: Pz1PdfSummary): Pz1PdfSection[] {
  return [
    {
      title: '1. Исходные данные',
      rows: [
        ['Команда', formatRequiredValue(summary.team)],
        ['Учебная группа', formatRequiredValue(summary.lineTitle)],
        ['Вариант', formatRequiredValue(summary.variantTitle)],
        ['Дата выполнения', formatDate(summary.createdAt)],
        // Идентификатор прохода: две работы с одинаковым id — это один и тот же
        // проход, то есть один файл, переданный из рук в руки.
        ['Идентификатор работы', formatRequiredValue(summary.runId)],
      ],
    },
    {
      title: '2. План трассы и размещение станций',
      rows: [
        ['Станций с координатами', String(summary.stationCount)],
        ['Точек линии трассы', String(summary.routePointCount)],
        ['Общая длина трассы', formatKm(summary.totalLengthKm)],
        ['Формат линии', 'Отдельный массив вершин [долгота, широта], не линия по станциям'],
      ],
    },
    {
      title: '3. Заполнение расчётных таблиц',
      rows: [
        ['Заполнено ячеек по корреспонденциям', String(summary.filledConsumerCells)],
        ['Технико-экономические показатели', String(summary.filledIndicatorCount)],
      ],
    },
  ];
}

function Pz1ReportDocument({ summary }: { summary: Pz1PdfSummary }) {
  const sections = createPz1PdfSections(summary);

  // Свойства файла заполняем сами: без них в «Producer» и «Creator» каждого
  // студенческого отчёта остаётся название библиотеки, которой он собран.
  return (
    <Document
      author="Школа ВСМ"
      creator="vsm-simulator.ru"
      producer="vsm-simulator.ru"
      subject="Технико-экономическое обоснование проекта ВСМ"
      title={`Практическое задание № 1 — ${summary.team || 'команда не указана'}`}
    >
      <Page size={PAGE_SIZE} style={styles.page}>
        <View style={styles.titleBlock}>
          <Text style={styles.assignment}>Практическое задание № 1</Text>
          <Text style={styles.title}>Технико-экономическое обоснование проекта ВСМ</Text>
        </View>
        <KeyValueTable rows={sections[0].rows} />
        <View style={styles.contents}>
          <Text style={styles.sectionTitle}>Содержание</Text>
        <Text style={styles.contentsLine}>1. Исходные данные варианта</Text>
        <Text style={styles.contentsLine}>2. План трассы и размещение станций</Text>
        <Text style={styles.contentsLine}>3. Матрица корреспонденций и коэффициенты дискомфорта</Text>
        <Text style={styles.contentsLine}>4. Прогноз пассажиропотока</Text>
        <Text style={styles.contentsLine}>5. Технико-экономические показатели</Text>
        </View>
      </Page>

      <Page size={PAGE_SIZE} style={styles.page}>
        <RunningHeader section="Исходные данные и план трассы" summary={summary} />
        <Text style={styles.sectionTitle}>1. Исходные данные варианта</Text>
        <KeyValueTable rows={sections[0].rows} />
        <Text style={styles.sectionTitle}>2. План трассы и размещение станций</Text>
        <KeyValueTable rows={sections[1].rows} />
        <Text style={styles.caption}>Рисунок 1 — План трассы ВСМ с размещением станций</Text>
        <MapPlanPreview previewImage={summary.previewImage} routeLine={summary.routeLine} stations={summary.stations ?? []} />
        <StationTable stations={summary.stations ?? []} />
        <RouteSegmentTable routeLine={summary.routeLine} />
        <StationRouteDistanceTable distances={summary.stationRouteDistances ?? []} />
        <HsrTravelTimeTable hsrTravelTime={summary.hsrTravelTime} />
      </Page>

      <Page size={PAGE_SIZE} style={styles.page}>
        <RunningHeader section="Корреспонденции и прогноз" summary={summary} />
        <Text style={styles.sectionTitle}>3. Матрица корреспонденций</Text>
        <KeyValueTable rows={sections[2].rows} />
        <RegionalCharacteristicsTable regionalCharacteristics={summary.regionalCharacteristics} />
        <CorrespondenceScenariosTable scenarios={summary.correspondenceScenarios ?? {}} />
        <Text style={styles.sectionTitle}>4. Прогноз пассажиропотока</Text>
        <PassengerFlowForecastReport forecast={summary.passengerFlowForecast} />
      </Page>

      <Page size={PAGE_SIZE} style={styles.page}>
        <RunningHeader section="Технико-экономические показатели" summary={summary} />
        <Text style={styles.sectionTitle}>5. Технико-экономические показатели</Text>
        <FinalIndicatorsTable finalIndicatorValues={summary.finalIndicators ?? {}} totalLengthKm={summary.totalLengthKm} />
        {summary.notes ? (
          <>
            <Text style={styles.sectionTitle}>Комментарий к исходным данным</Text>
            <Text style={styles.paragraph}>{summary.notes}</Text>
          </>
        ) : null}
      </Page>
    </Document>
  );
}

/**
 * Колонтитул: слева — чья работа, справа — название раздела.
 *
 * Номера листа здесь намеренно нет. Раньше он задавался строкой («2», «3»,
 * «4») на каждый элемент Page, но Page переносится на несколько физических
 * листов, и номер повторялся: листы 2 и 3 были оба подписаны «2», листы
 * 4–6 — «3». То есть номер был не просто бесполезен, а неверен.
 *
 * Штатный способ — динамический `render={({ pageNumber }) => …}` — в
 * браузерной сборке @react-pdf/renderer 4.5.1 не вызывается вовсе:
 * проверено подстановкой константы, в PDF не попадает ничего. В Node на той
 * же версии тот же код работает. Пока это не разобрано, в колонтитуле стоит
 * название раздела — оно всегда верно и помогает ориентироваться не хуже.
 */
function RunningHeader({ section, summary }: { section: string; summary: Pz1PdfSummary }) {
  return (
    <View style={styles.runningHeader} fixed>
      <Text style={styles.runningHeaderPrimary}>
        Команда «{formatRequiredValue(summary.team)}» · ПЗ1 · {formatRequiredValue(summary.lineTitle)}
      </Text>
      <Text style={styles.runningHeaderSection}>{section}</Text>
    </View>
  );
}

function MapPlanPreview({
  previewImage,
  routeLine,
  stations,
}: {
  previewImage?: string;
  routeLine?: RouteLine;
  stations: PdfStation[];
}) {
  const overlay = createMapOverlay(routeLine, stations);
  const hasOverlay = overlay.routePoints.length >= 2 || overlay.stationPoints.length > 0;

  // Снимок карты уже содержит и трассу, и станции в проекции самой карты.
  // Дорисовывать поверх него схему нельзя: у неё своя линейная проекция, с
  // веб-меркатором она не совпадает и линия ложится мимо. Схему показываем
  // только когда снимка нет — как запасной вариант, а не как слой поверх.
  const showSchematicOverlay = !previewImage && hasOverlay;

  return (
    <View style={styles.mapFrame}>
      {previewImage ? (
        <Image src={previewImage} style={styles.mapImage} />
      ) : (
        <View style={styles.mapFallback}>
          {hasOverlay ? null : <Text style={styles.mapText}>Снимок карты не был сохранён в результате шага.</Text>}
        </View>
      )}
      {showSchematicOverlay ? (
        <Svg
          height={PDF_MAP_HEIGHT}
          style={styles.mapOverlay}
          viewBox={`0 0 ${PDF_MAP_WIDTH} ${PDF_MAP_HEIGHT}`}
          width={PDF_MAP_WIDTH}
        >
          {overlay.routePoints.length >= 2 ? (
            <>
              <Polyline
                fill="none"
                points={formatSvgPoints(overlay.routePoints)}
                stroke="#ffffff"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={6.5}
              />
              <Polyline
                fill="none"
                points={formatSvgPoints(overlay.routePoints)}
                stroke="#E0182D"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3.5}
              />
            </>
          ) : null}
          {overlay.stationPoints.map((point) => (
            <Circle cx={point.x} cy={point.y} fill="#003D84" key={point.key} r={4.2} stroke="#ffffff" strokeWidth={1.5} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

function StationTable({ stations }: { stations: PdfStation[] }) {
  if (stations.length === 0) {
    return <Text style={styles.paragraph}>Станции пока не назначены.</Text>;
  }

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={styles.stationLabelCell}>Станция</Text>
        <Text style={[styles.stationTypeCell, styles.stationTypeWideCell]}>Тип</Text>
        <Text style={[styles.stationNameCell, styles.stationNarrowCell]}>Название</Text>
        <Text style={[styles.stationNameCell, styles.stationNarrowCell]}>Регион</Text>
        <Text style={[styles.stationCoordCell, styles.stationNarrowCell]}>Координаты</Text>
      </View>
      {stations.map((station) => (
        <View key={station.label} style={styles.tableRow}>
          <Text style={styles.stationLabelCell}>{station.label}</Text>
          <Text style={[styles.stationTypeCell, styles.stationTypeWideCell]}>{formatStationType(station.type)}</Text>
          <Text style={[styles.stationNameCell, styles.stationNarrowCell]}>{station.name}</Text>
          <Text style={[styles.stationNameCell, styles.stationNarrowCell]}>{station.region ?? 'не выбран'}</Text>
          <Text style={[styles.stationCoordCell, styles.stationNarrowCell]}>
            {formatNumber(station.lat)}; {formatNumber(station.lng)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RouteSegmentTable({ routeLine }: { routeLine?: RouteLine }) {
  if (!routeLine || routeLine.segments.length === 0) {
    return <Text style={styles.paragraph}>Сегменты трассы пока не заданы.</Text>;
  }

  const metrics = computeRouteLineMetrics(routeLine);

  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.stationLabelCell, styles.segmentIndexCell]}>№</Text>
        <Text style={[styles.stationTypeCell, styles.segmentWideCell]}>Радиус между точками</Text>
        <Text style={[styles.stationNameCell, styles.segmentWideCell]}>Радиус</Text>
        <Text style={[styles.stationCoordCell, styles.segmentWideCell]}>Длина</Text>
      </View>
      {metrics.segments.map((segment, index) => (
        <View key={segment.segmentId} style={styles.tableRow}>
          <Text style={[styles.stationLabelCell, styles.segmentIndexCell]}>{index + 1}</Text>
          <Text style={[styles.stationTypeCell, styles.segmentWideCell]}>{formatMeters(routeLine.segments[index].sagittaKm * 1000)}</Text>
          <Text style={[styles.stationNameCell, styles.segmentWideCell]}>{segment.radiusKm ? formatKm(segment.radiusKm) : 'прямая вставка'}</Text>
          <Text style={[styles.stationCoordCell, styles.segmentWideCell]}>{formatKm(segment.arcLengthKm)}</Text>
        </View>
      ))}
    </View>
  );
}

function StationRouteDistanceTable({ distances }: { distances: StationRouteDistance[] }) {
  if (distances.length === 0) {
    return null;
  }

  return (
    <>
      <Text style={styles.caption}>Таблица 1 — Расстояния между соседними станциями вдоль трассы</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.stationTypeCell, styles.halfCell]}>Участок</Text>
          <Text style={[styles.stationCoordCell, styles.halfCell]}>Длина по трассе</Text>
        </View>
        {distances.map((distance) => (
          <View key={`${distance.fromLabel}-${distance.toLabel}`} style={styles.tableRow}>
            <Text style={[styles.stationTypeCell, styles.halfCell]}>
              {distance.fromLabel} — {distance.toLabel}
            </Text>
            <Text style={[styles.stationCoordCell, styles.halfCell]}>{formatKm(distance.distanceKm)}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function HsrTravelTimeTable({ hsrTravelTime }: { hsrTravelTime?: Pz1Result['hsrTravelTime'] }) {
  if (!hsrTravelTime) {
    return <Text style={styles.paragraph}>Время хода ВСМ пока не рассчитано.</Text>;
  }

  return (
    <>
      <Text style={styles.caption}>Таблица 2 — Время хода ВСМ по перегонам</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.stationTypeCell, styles.hsrSegmentCell]}>Перегон</Text>
          <Text style={[styles.stationCoordCell, styles.hsrDistanceCell]}>Расстояние, км</Text>
          <Text style={[styles.stationCoordCell, styles.hsrSpeedCell]}>Скорость, км/ч</Text>
          <Text style={[styles.stationCoordCell, styles.hsrAccelCell]}>Разгон, мин</Text>
          <Text style={[styles.stationCoordCell, styles.hsrBrakeCell]}>Торможение, мин</Text>
          <Text style={[styles.stationCoordCell, styles.hsrTimeCell]}>Время</Text>
        </View>
        {hsrTravelTime.segments.map((segment) => (
          <View key={`${segment.fromLabel}-${segment.toLabel}`} style={styles.tableRow}>
            <Text style={[styles.stationTypeCell, styles.hsrSegmentCell]}>
              {segment.fromLabel} — {segment.toLabel}
            </Text>
            <Text style={[styles.stationCoordCell, styles.hsrDistanceCell]}>{formatDistanceKm(segment.distanceKm)}</Text>
            <Text style={[styles.stationCoordCell, styles.hsrSpeedCell]}>{formatNumber(segment.speedKmh)}</Text>
            <Text style={[styles.stationCoordCell, styles.hsrAccelCell]}>{formatNumber(hsrTravelTime.accelerationMinutes)}</Text>
            <Text style={[styles.stationCoordCell, styles.hsrBrakeCell]}>{formatNumber(hsrTravelTime.brakingMinutes)}</Text>
            <Text style={[styles.stationCoordCell, styles.hsrTimeCell]}>{formatDuration(segment.travelTimeMinutes)}</Text>
          </View>
        ))}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.stationTypeCell, styles.hsrSegmentCell]}>Итого</Text>
          <Text style={[styles.stationCoordCell, styles.hsrDistanceCell]}>—</Text>
          <Text style={[styles.stationCoordCell, styles.hsrSpeedCell]}>—</Text>
          <Text style={[styles.stationCoordCell, styles.hsrAccelCell]}>
            {formatDuration(hsrTravelTime.accelerationMinutes * hsrTravelTime.segments.length)}
          </Text>
          <Text style={[styles.stationCoordCell, styles.hsrBrakeCell]}>
            {formatDuration(hsrTravelTime.brakingMinutes * hsrTravelTime.segments.length)}
          </Text>
          <Text style={[styles.stationCoordCell, styles.hsrTimeCell]}>{formatDuration(hsrTravelTime.totalMinutes)}</Text>
        </View>
      </View>
    </>
  );
}

function RegionalCharacteristicsTable({
  regionalCharacteristics,
}: {
  regionalCharacteristics?: Pz1Result['regionalCharacteristics'];
}) {
  if (!regionalCharacteristics) {
    return <Text style={styles.paragraph}>Характеристики регионов пока не заполнены.</Text>;
  }

  const regionEntries = Object.entries(regionalCharacteristics.regionParameters ?? {});

  if (regionEntries.length > 0) {
    return (
      <>
        <Text style={styles.caption}>Таблица 3 — Характеристики регионов для прогноза</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.metricCell}>Регион</Text>
            <Text style={styles.modeCell}>ВРП сущ.</Text>
            <Text style={styles.modeCell}>ВРП прогноз</Text>
            <Text style={styles.modeCell}>Население сущ.</Text>
            <Text style={styles.modeCell}>Население прогноз</Text>
            <Text style={styles.modeCell}>Зарплата</Text>
            <Text style={styles.modeCell}>Коэфф. ВВП</Text>
          </View>
          {regionEntries.map(([region, parameters]) => (
            <View key={region} style={styles.tableRow}>
              <Text style={styles.metricCell}>{region}</Text>
              <Text style={styles.modeCell}>{formatRequiredValue(parameters.grpExisting)}</Text>
              <Text style={styles.modeCell}>{formatRequiredValue(parameters.grpForecast)}</Text>
              <Text style={styles.modeCell}>{formatRequiredValue(parameters.populationExisting)}</Text>
              <Text style={styles.modeCell}>{formatRequiredValue(parameters.populationForecast)}</Text>
              <Text style={styles.modeCell}>{formatRequiredValue(parameters.averageSalary)}</Text>
              <Text style={styles.modeCell}>{formatRequiredValue(parameters.kGdpFlow)}</Text>
            </View>
          ))}
          <View style={styles.tableRow}>
            <Text style={styles.metricCell}>Индуцированный спрос, %</Text>
            <Text style={styles.modeCell}>{formatRequiredValue(regionalCharacteristics.inducedDemandPct)}</Text>
            <Text style={styles.modeCell}>—</Text>
            <Text style={styles.modeCell}>—</Text>
            <Text style={styles.modeCell}>—</Text>
            <Text style={styles.modeCell}>—</Text>
            <Text style={styles.modeCell}>—</Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Text style={styles.caption}>Таблица 3 — Характеристики регионов для прогноза</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={styles.metricCell}>Показатель</Text>
          <Text style={styles.flowValueCell}>{regionalCharacteristics.regionA || 'Регион 1'}</Text>
          <Text style={styles.flowValueCell}>{regionalCharacteristics.regionB || 'Регион 2'}</Text>
        </View>
        {[
          ['ВРП, существующий, млн руб.', regionalCharacteristics.grpExistingRegionA, regionalCharacteristics.grpExistingRegionB],
          ['ВРП, прогнозный, млн руб.', regionalCharacteristics.grpForecastRegionA, regionalCharacteristics.grpForecastRegionB],
          [
            'Численность населения, тыс. чел.',
            regionalCharacteristics.populationExistingRegionA,
            regionalCharacteristics.populationExistingRegionB,
          ],
          [
            'Численность населения, прогноз, тыс. чел.',
            regionalCharacteristics.populationForecastRegionA,
            regionalCharacteristics.populationForecastRegionB,
          ],
          ['Средняя заработная плата, руб./мес.', regionalCharacteristics.averageSalaryRegionA, regionalCharacteristics.averageSalaryRegionB],
          [
            'Коэффициент влияния ВВП на пассажиропоток',
            regionalCharacteristics.kGdpFlowRegionA,
            regionalCharacteristics.kGdpFlowRegionB,
          ],
        ].map(([label, valueA, valueB]) => (
          <View key={label} style={styles.tableRow}>
            <Text style={styles.metricCell}>{label}</Text>
            <Text style={styles.flowValueCell}>{formatRequiredValue(valueA)}</Text>
            <Text style={styles.flowValueCell}>{formatRequiredValue(valueB)}</Text>
          </View>
        ))}
        <View style={styles.tableRow}>
          <Text style={styles.metricCell}>Прогнозируемый индуцированный спрос, %</Text>
          <Text style={styles.flowValueCell}>{formatRequiredValue(regionalCharacteristics.inducedDemandPct)}</Text>
          <Text style={styles.flowValueCell}>{formatRequiredValue(regionalCharacteristics.inducedDemandPct)}</Text>
        </View>
      </View>
    </>
  );
}

function CorrespondenceScenariosTable({ scenarios }: { scenarios: NonNullable<Pz1Result['correspondenceScenarios']> }) {
  const scenarioList = Object.values(scenarios);

  if (scenarioList.length === 0) {
    return null;
  }

  return (
    <>
      {scenarioList.map((scenario, scenarioIndex) => (
        <View key={scenario.pairKey} style={styles.compactTableBlock} wrap={false}>
          {/* Подпись таблицы живёт внутри первого блока: снаружи она оставалась
              внизу предыдущей страницы, а сама таблица уезжала на следующую. */}
          {scenarioIndex === 0 ? <Text style={styles.caption}>Таблица 4 — Расчёты по корреспонденциям</Text> : null}
          <Text style={styles.compactTableTitle}>{scenario.title}</Text>
          <View style={styles.compactTable}>
            <View style={styles.compactHeaderRow}>
              <Text style={styles.flowModeCell}>Вид транспорта</Text>
              <Text style={styles.modeCell}>Время в пути</Text>
              <Text style={styles.modeCell}>Дискомфорт</Text>
              <Text style={styles.modeCell}>Рейсов в сутки</Text>
              <Text style={styles.modeCell}>Стоимость, руб.</Text>
              <Text style={styles.modeCell}>Пассажиров в год</Text>
            </View>
            {transportColumns.map((column) => (
              <View key={column.id} style={styles.tableRow}>
                <Text style={styles.flowModeCell}>{column.label}</Text>
                <Text style={styles.modeCell}>{formatSplitValue(
                  formatScenarioTravelTime(scenario.travelTime, column.id, 'existing'),
                  formatScenarioTravelTime(scenario.travelTime, column.id, 'forecast'),
                )}</Text>
                <Text style={styles.modeCell}>{formatSplitValue(
                  formatNullableNumber(scenario.discomfortAggregates[column.id]?.existing),
                  formatNullableNumber(scenario.discomfortAggregates[column.id]?.forecast),
                )}</Text>
                <Text style={styles.modeCell}>{formatSplitValue(
                  formatRequiredValue(scenario.frequency[column.id]?.existing ?? ''),
                  formatRequiredValue(scenario.frequency[column.id]?.forecast ?? ''),
                )}</Text>
                <Text style={styles.modeCell}>{formatSplitValue(
                  formatRequiredValue(scenario.fare[column.id]?.existing ?? ''),
                  formatRequiredValue(scenario.fare[column.id]?.forecast ?? ''),
                )}</Text>
                <Text style={styles.modeCell}>{formatSplitValue(
                  formatOptionalInteger(scenario.annualFlows[column.id]?.existingAnnualFlow),
                  formatOptionalInteger(scenario.annualFlows[column.id]?.forecastAnnualFlow),
                )}</Text>
              </View>
            ))}
          </View>
          {scenario.passengerFlowForecast ? (
            <View style={styles.compactTable}>
              <View style={styles.compactHeaderRow}>
                <Text style={styles.flowModeCell}>Вид транспорта</Text>
                <Text style={styles.flowValueCell}>Существующий поток</Text>
                <Text style={styles.flowValueCell}>Прогноз</Text>
                <Text style={styles.flowShareCell}>Доля</Text>
              </View>
              {scenario.passengerFlowForecast.modes.map((mode) => (
                <View key={mode.modeId} style={styles.tableRow}>
                  <Text style={styles.flowModeCell}>{getTransportModeLabel(mode.modeId)}</Text>
                  <Text style={styles.flowValueCell}>{formatInteger(mode.existingAnnualFlow)}</Text>
                  <Text style={styles.flowValueCell}>{formatInteger(mode.forecastAnnualFlow)}</Text>
                  <Text style={styles.flowShareCell}>{formatPercent(mode.forecastShare)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.paragraph}>Модель по этой корреспонденции пока не рассчитана.</Text>
          )}
        </View>
      ))}
    </>
  );
}

function PassengerFlowForecastReport({ forecast }: { forecast?: Pz1PassengerFlowResult }) {
  if (!forecast) {
    return <Text style={styles.paragraph}>Прогноз пассажиропотока пока не рассчитан.</Text>;
  }

  return (
    <View>
      {/* Единица вынесена в подпись таблицы: длинные подписи строк движок
          переносил внутри слова и рисовал на месте переноса дефис, которого
          нет в кириллическом наборе PT Serif, — в отчёте выходил квадратик. */}
      <Text style={styles.caption}>Итоги прогноза, пассажиров в год</Text>
      <KeyValueTable
        rows={[
          ['Существующий рынок', formatInteger(forecast.totalDemand.existingAnnualFlow)],
          ['Базовый прогноз', formatInteger(forecast.totalDemand.baseForecast)],
          ['Индуцированный спрос', formatInteger(forecast.totalDemand.inducedDemand)],
          ['Итоговый прогноз', formatInteger(forecast.totalDemand.totalForecast)],
        ]}
      />
      <Text style={styles.caption}>Таблица 3 — Распределение прогноза пассажиропотока по видам транспорта</Text>
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={styles.flowModeCell}>Вид транспорта</Text>
          <Text style={styles.flowValueCell}>Существующий поток</Text>
          <Text style={styles.flowValueCell}>Прогноз</Text>
          <Text style={styles.flowShareCell}>Доля</Text>
        </View>
        {forecast.modes.map((mode) => (
          <View key={mode.modeId} style={styles.tableRow}>
            <Text style={styles.flowModeCell}>{getTransportModeLabel(mode.modeId)}</Text>
            <Text style={styles.flowValueCell}>{formatInteger(mode.existingAnnualFlow)}</Text>
            <Text style={styles.flowValueCell}>{formatInteger(mode.forecastAnnualFlow)}</Text>
            <Text style={styles.flowShareCell}>{formatPercent(mode.forecastShare)}</Text>
          </View>
        ))}
      </View>
      <View wrap={false}>
        <Text style={styles.caption}>Рисунок 2 — Распределение пассажиропотока по видам транспорта</Text>
        <PassengerFlowForecastChart forecast={forecast} />
      </View>
    </View>
  );
}

function PassengerFlowForecastChart({ forecast }: { forecast: Pz1PassengerFlowResult }) {
  const periods = buildPassengerFlowStackedData(forecast);
  const totals = periods.map((period) =>
    passengerFlowChartModes.reduce((sum, mode) => sum + Number(period[mode.id] ?? 0), 0),
  );
  const maxTotal = Math.max(1, ...totals);
  const plotHeight = 132;

  return (
    <View style={styles.passengerFlowChartFrame} wrap={false}>
      <Text style={styles.passengerFlowChartTitle}>Распределение пассажиропотока, пасс./год</Text>
      <View style={styles.passengerFlowStackedChart}>
        {periods.map((period, index) => (
          <View key={period.period} style={styles.passengerFlowStackedColumn}>
            <Text style={styles.passengerFlowStackedTotal}>{formatInteger(totals[index])}</Text>
            <View style={styles.passengerFlowStackedArea}>
              <View style={{ width: 88, height: (totals[index] / maxTotal) * plotHeight }}>
                {[...passengerFlowChartModes].reverse().map((mode) => (
                  <View
                    key={mode.id}
                    style={{
                      backgroundColor: mode.color,
                      height: (Number(period[mode.id] ?? 0) / maxTotal) * plotHeight,
                      width: '100%',
                    }}
                  />
                ))}
              </View>
            </View>
            <Text style={styles.passengerFlowStackedPeriod}>{period.period}</Text>
          </View>
        ))}
      </View>
      <View style={styles.passengerFlowLegend}>
        {passengerFlowChartModes.map((mode) => (
          <View key={mode.id} style={styles.passengerFlowLegendItem}>
            <View style={[styles.passengerFlowLegendSwatch, { backgroundColor: mode.color }]} />
            <Text>{mode.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FinalIndicatorsTable({
  finalIndicatorValues,
  totalLengthKm,
}: {
  finalIndicatorValues: Record<string, string>;
  totalLengthKm: number;
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={styles.finalIndexCell}>№</Text>
        <Text style={styles.finalNameCell}>Показатель</Text>
        <Text style={styles.finalValueCell}>Значение</Text>
      </View>
      {finalIndicators.map((indicator, index) => (
        <View key={indicator.id} style={styles.tableRow}>
          <Text style={styles.finalIndexCell}>{index + 1}</Text>
          <Text style={styles.finalNameCell}>{indicator.label}</Text>
          <Text style={styles.finalValueCell}>
            {indicator.id === 'lineLength'
              ? formatKm(totalLengthKm)
              : formatRequiredValue(finalIndicatorValues[indicator.id] ?? '')}
          </Text>
        </View>
      ))}
    </View>
  );
}

function getTransportModeLabel(modeId: string) {
  return transportColumns.find((column) => column.id === modeId)?.label ?? modeId;
}

function formatScenarioTravelTime(
  travelTime: NonNullable<Pz1Result['correspondenceScenarios']>[string]['travelTime'],
  modeId: TransportModeId,
  side: 'existing' | 'forecast',
) {
  const totalMinutes = correspondenceTravelTimeRows.reduce<number | null>((sum, row) => {
    if (sum === null) {
      return null;
    }

    const value = travelTime[row.id]?.[modeId]?.[side] ?? '';
    const minutes = parseDurationToMinutes(value);
    return minutes === null ? null : sum + minutes;
  }, 0);

  return totalMinutes === null ? 'не заполнено' : formatDuration(totalMinutes);
}

/**
 * Пара «существующее / прогнозное» в узкой ячейке отчёта.
 *
 * Значения ставятся на разные строки, а не через косую черту: движок разметки
 * переносит длинную строку по любому месту, включая неразрывный пробел внутри
 * числа, и дописывает дефис — в отчёте выходило «970 900 / 970-» и «900»
 * на следующей строке. Явный перенос убирает у него выбор.
 */
function formatSplitValue(existingValue: string, forecastValue: string) {
  return `${existingValue}\n${forecastValue}`;
}

function formatOptionalInteger(value: number | undefined) {
  return value === undefined ? 'не заполнено' : formatInteger(value);
}

function formatNullableNumber(value: number | null | undefined) {
  return value === null || value === undefined ? 'не заполнено' : formatNumber(value);
}

function parseDurationToMinutes(value: string) {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Значение, введённое студентом, — в отчёт в том же виде, в каком он видел его
 * на экране: с разделением разрядов (ТЗ v3.5 §3 П-05). Раньше в PDF уходило
 * сырое «14500000», хотя на экране стояло «14 500 000».
 */
function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 5 }).format(value);
}

/**
 * Расстояния в километрах — везде 2 знака, включая внутренние таблицы отчёта
 * (ТЗ v3.6 T-6). На экране было «610,32», а в таблице перегонов PDF — «610,315»
 * от общего formatNumber с пятью знаками, и одна величина читалась двумя
 * разными числами. Округляем ТОЛЬКО при отображении: в расчёт длина идёт с
 * полной точностью, она участвует во времени хода и стоимости личного авто.
 */
export function formatDistanceKm(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, style: 'percent' }).format(value);
}

function formatKm(value: number, zeroText = 'не рассчитано') {
  if (value <= 0) {
    return zeroText;
  }

  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} км`;
}

function formatMeters(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.max(0, value))} м`;
}

function formatDuration(totalMinutes: number) {
  const roundedMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatStationType(type: PdfStation['type']) {
  // Дефис обычный. Неразрывный U+2011 тут не годится: в подключённом наборе
  // PT Serif у него нет глифа, и слово печаталось как «начальноконечная».
  // Перенос по дефису (с удвоением) снят тем, что столбец «Тип» расширен до
  // 25 % — слово помещается в строку целиком.
  return type === 'terminal' ? 'начально-конечная' : 'промежуточная';
}

function createMapOverlay(routeLine: RouteLine | undefined, stations: PdfStation[]): PdfMapOverlay {
  const routeGeoPoints = routeLine ? buildDisplayRoutePoints(routeLine, 32) : [];
  const stationGeoPoints = stations
    .map((station) => ({ key: station.label, lon: station.lng, lat: station.lat }))
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat));
  const boundsPoints: GeoPoint[] = [...routeGeoPoints, ...stationGeoPoints];

  if (boundsPoints.length === 0) {
    return { routePoints: [], stationPoints: [] };
  }

  const project = createPdfMapProjection(boundsPoints);

  return {
    routePoints: routeGeoPoints.map(project),
    stationPoints: stationGeoPoints.map((point) => ({
      key: point.key,
      ...project(point),
    })),
  };
}

function createPdfMapProjection(points: GeoPoint[]) {
  // Та же веб-меркаторная геометрия, что у экранной карты. Прежняя линейная
  // проекция независимо растягивала широту и долготу до рамки, поэтому маршрут
  // в PDF менял форму и выглядел как декоративная диагональ.
  const projected = points.map((point) => ({
    x: (point.lon * Math.PI) / 180,
    y: Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, point.lat)) * Math.PI) / 360)),
  }));
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const xSpan = Math.max(maxX - minX, 1e-9);
  const ySpan = Math.max(maxY - minY, 1e-9);
  const innerWidth = PDF_MAP_WIDTH - PDF_MAP_PADDING * 2;
  const innerHeight = PDF_MAP_HEIGHT - PDF_MAP_PADDING * 2;
  const scale = Math.min(innerWidth / xSpan, innerHeight / ySpan);
  const drawnWidth = xSpan * scale;
  const drawnHeight = ySpan * scale;
  const offsetX = PDF_MAP_PADDING + (innerWidth - drawnWidth) / 2;
  const offsetY = PDF_MAP_PADDING + (innerHeight - drawnHeight) / 2;

  return (point: GeoPoint): PdfMapPoint => {
    const x = (point.lon * Math.PI) / 180;
    const y = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, point.lat)) * Math.PI) / 360));
    return {
      x: offsetX + (x - minX) * scale,
      y: offsetY + (maxY - y) * scale,
    };
  };
}

function formatSvgPoints(points: PdfMapPoint[]) {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}
