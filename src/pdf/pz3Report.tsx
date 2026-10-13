import { Document, Image, Page, Path, StyleSheet, Svg, Text, View, pdf } from '@react-pdf/renderer';
import { downloadTextFile } from '../bridge/io';
import type { Pz3Result } from '../bridge/schema';
import { PZ3_ICON_GRID, PZ3_ICON_STROKE, getPz3IconKinds, getPz3WorkIcon } from '../modules/pz3/workIcons';
import { PZ3_LENGTH_TOLERANCE_KM } from '../modules/pz3/model';
import { KeyValueTable, PAGE_SIZE, formatDate, formatRequiredValue, styles } from './common';

/**
 * Отчёт по ПЗ3 — то, по чему преподаватель проверяет работу.
 *
 * В проекте нет ни бэкенда, ни журнала: студент сдаёт PDF, как и по ПЗ1.
 * Поэтому отчёт повторяет структуру задания — работы, этапы, ресурсный план,
 * расход материалов — и печатает те же числа, что студент видел на экранах.
 * Вёрстка общая с ПЗ1 (`./common`): это документы одного курса.
 */
export interface Pz3PdfSummary {
  team: string;
  lineTitle: string;
  createdAt: string;
  runId?: string;
  /** Длина маршрута из ПЗ1 — эталон, с которым сверялась сумма работ. */
  routeLengthKm: number;
  /** Снимок карты трассы. Пусто — студент не открывал карту в этом проходе. */
  previewImage?: string;
  result: Pz3Result;
  /** Подписи типов работ и условий грунта: словарь живёт в модуле задания. */
  workKindLabels: Record<string, string>;
  conditionLabels: Record<string, string>;
}

const mapStyles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 18,
    marginBottom: 4,
  },
  legendIcon: {
    marginRight: 5,
  },
  legendText: {
    fontSize: 9,
  },
  workTypeCell: { width: '20%' },
  workVolumeCell: { width: '15%' },
  workConditionsCell: { width: '25%' },
  workStageCell: { width: '40%' },
  stageTitleCell: { width: '40%' },
  stageCountCell: { width: '15%' },
  stageLengthCell: { width: '20%' },
  stageWorkersCell: { width: '25%' },
});

export async function downloadPz3Pdf(summary: Pz3PdfSummary, fileName: string): Promise<void> {
  const blob = await createPz3PdfBlob(summary);
  downloadTextFile(fileName, 'application/pdf', await blob.arrayBuffer());
}

export async function createPz3PdfBlob(summary: Pz3PdfSummary): Promise<Blob> {
  return pdf(<Pz3ReportDocument summary={summary} />).toBlob();
}

function Pz3ReportDocument({ summary }: { summary: Pz3PdfSummary }) {
  const { result } = summary;
  const measuredKm = result.measuredLengthKm;
  const difference = measuredKm - summary.routeLengthKm;
  const lengthMatches = Math.abs(difference) <= PZ3_LENGTH_TOLERANCE_KM;
  const worksWithoutPosition = result.works.filter((work) => work.lengthKm !== null && !work.span).length;

  return (
    <Document
      author="Школа ВСМ"
      creator="vsm-simulator.ru"
      producer="vsm-simulator.ru"
      subject="Организация строительства ВСМ"
      title={`Практическое задание № 3 — ${summary.team || 'команда не указана'}`}
    >
      <Page size={PAGE_SIZE} style={styles.page}>
        <View style={styles.titleBlock}>
          <Text style={styles.assignment}>Практическое задание № 3</Text>
          <Text style={styles.title}>Организация строительства ВСМ</Text>
        </View>

        <KeyValueTable
          rows={[
            ['Команда', formatRequiredValue(summary.team)],
            ['Учебная группа', formatRequiredValue(summary.lineTitle)],
            ['Дата выполнения', formatDate(summary.createdAt)],
            ['Идентификатор работы', formatRequiredValue(summary.runId ?? '')],
          ]}
        />

        <View style={styles.contents}>
          <Text style={styles.sectionTitle}>Содержание</Text>
          <Text style={styles.contentsLine}>1. Трасса на карте</Text>
          <Text style={styles.contentsLine}>2. Сводка объёмов работ</Text>
          <Text style={styles.contentsLine}>3. Работы по трассе и этапы</Text>
          <Text style={styles.contentsLine}>4. Ресурсный график</Text>
          <Text style={styles.contentsLine}>5. Расход материалов и машино-часы</Text>
        </View>
      </Page>

      <Page size={PAGE_SIZE} style={styles.page}>
        <Header section="Трасса" summary={summary} />

        <Text style={styles.sectionTitle}>1. Трасса на карте</Text>
        <Text style={styles.paragraph}>
          Трасса и станции перенесены из ПЗ1. Значками показаны объекты на трассе; цветом отмечены только те этапы,
          для работ которых участок был измерен на карте. Снимок сделан с той же карты и в той же проекции, что на экране.
        </Text>
        {worksWithoutPosition > 0 ? (
          <Text style={styles.paragraph}>
            Работ с длиной, введённой без отметок на карте: {worksWithoutPosition}. Их положение на трассе не задано,
            поэтому эти участки на снимке не окрашены по этапам.
          </Text>
        ) : null}
        <MapPreview previewImage={summary.previewImage} />
        <WorkIconLegend result={result} />
      </Page>

      <Page size={PAGE_SIZE} style={styles.page}>
        <Header section="Работы и этапы" summary={summary} />
        <Text style={styles.sectionTitle}>2. Сводка объёмов работ</Text>
        <KeyValueTable
          rows={[
            ['Работ перечислено', String(result.works.length)],
            ['Длина маршрута из ПЗ1', `${formatAmount(summary.routeLengthKm)} км`],
            ['Сумма длин работ', `${formatAmount(measuredKm)} км`],
            [
              'Расхождение',
              `${formatAmount(Math.abs(difference))} км${lengthMatches ? '' : difference < 0 ? ' (недомерено)' : ' (перемерено)'}`,
            ],
          ]}
        />
        <Text style={styles.sectionTitle}>По видам работ</Text>
        <KeyValueTable rows={summarizePz3Works(result, summary.workKindLabels)} />

        <Text style={styles.sectionTitle}>3. Работы по трассе</Text>

        {result.works.length > 0 ? (
          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCellLabel, mapStyles.workTypeCell]}>Тип работы</Text>
              <Text style={[styles.tableCellValue, mapStyles.workVolumeCell]}>Объём</Text>
              <Text style={[styles.tableCellValue, mapStyles.workConditionsCell]}>Опции</Text>
              <Text style={[styles.tableCellValue, mapStyles.workStageCell]}>Этап</Text>
            </View>
            {result.works.map((work) => (
              <View key={work.id} style={styles.tableRow}>
                <Text style={[styles.tableCellLabel, mapStyles.workTypeCell]}>{summary.workKindLabels[work.kind] ?? work.kind}</Text>
                <Text style={[styles.tableCellValue, mapStyles.workVolumeCell]}>
                  {work.lengthKm !== null ? `${formatAmount(work.lengthKm)} км` : `${formatAmount(work.count ?? 0)} шт.`}
                </Text>
                <Text style={[styles.tableCellValue, mapStyles.workConditionsCell]}>
                  {work.conditions.length === 0
                    ? 'обычные'
                    : work.conditions.map((condition) => summary.conditionLabels[condition] ?? condition).join(', ')}
                </Text>
                <Text style={[styles.tableCellValue, mapStyles.workStageCell]}>{findStageTitle(result, work.stageId)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.paragraph}>Работы не перечислены.</Text>
        )}

        <Text style={styles.sectionTitle}>3.1. Разбиение на этапы</Text>
        {result.stages.length > 0 ? (
          <View style={styles.table}>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCellLabel, mapStyles.stageTitleCell]}>Этап</Text>
              <Text style={[styles.tableCellValue, mapStyles.stageCountCell]}>Работ</Text>
              <Text style={[styles.tableCellValue, mapStyles.stageLengthCell]}>Длина, км</Text>
              <Text style={[styles.tableCellValue, mapStyles.stageWorkersCell]}>Рабочих</Text>
            </View>
            {result.stages.map((stage) => {
              const works = result.works.filter((work) => work.stageId === stage.id);
              const lengthKm = works.reduce((sum, work) => sum + (work.lengthKm ?? 0), 0);

              return (
                <View key={stage.id} style={styles.tableRow}>
                  <Text style={[styles.tableCellLabel, mapStyles.stageTitleCell]}>{stage.title}</Text>
                  <Text style={[styles.tableCellValue, mapStyles.stageCountCell]}>{works.length}</Text>
                  <Text style={[styles.tableCellValue, mapStyles.stageLengthCell]}>{formatAmount(lengthKm)}</Text>
                  <Text style={[styles.tableCellValue, mapStyles.stageWorkersCell]}>{result.plan.workersByStage[stage.id] ?? 0}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.paragraph}>Трасса на этапы не разбита.</Text>
        )}
      </Page>

      <Page size={PAGE_SIZE} style={styles.page}>
        <Header section="Ресурсы и расход" summary={summary} />

        <Text style={styles.sectionTitle}>4. Ресурсный график</Text>
        <KeyValueTable
          rows={[
            ['Рабочих на проект', String(result.plan.totalWorkers)],
            ['Срок строительства', result.plan.durationDays > 0 ? `${result.plan.durationDays} дн.` : 'не рассчитан'],
            ['Пиковая потребность', `${result.plan.peakWorkers} чел.`],
            ['Дней с нехваткой людей', String(result.plan.overloadDays)],
          ]}
        />
        <Text style={styles.paragraph}>
          Срок считается по трудоёмкости работ и числу назначенных рабочих. Ровная загрузка достигается перераспределением
          людей между этапами: этапы строятся параллельно, и пик потребности зависит от того, как они наложились во времени.
        </Text>

        <Text style={styles.sectionTitle}>5. Расход материалов и машино-часы</Text>
        <KeyValueTable
          rows={[
            ['Трудоёмкость', `${formatAmount(result.report.laborHours)} чел.-ч`],
            ['Машино-часы', `${formatAmount(result.report.machineHours)} маш.-ч`],
          ]}
        />

      </Page>

      {/* Таблицы расхода — отдельной страницей: на общей они упирались в край,
          и последняя страница выходила пустой, с одним колонтитулом. */}
      <Page size={PAGE_SIZE} style={styles.page}>
        <Header section="Расход по проекту" summary={summary} />
        <Text style={styles.sectionTitle}>5.1. Материалы</Text>
        <ResourceTable rows={result.report.materials} />
        <Text style={styles.sectionTitle}>5.2. Машины</Text>
        <ResourceTable rows={result.report.machines} />
      </Page>
    </Document>
  );
}

/**
 * Снимок карты в отчёте.
 *
 * Рисовать карту в PDF заново нечем: подложка приходит тайлами, а своя схема
 * «долгота/широта → прямоугольник» с веб-меркатором не совпадает и кладёт
 * трассу мимо. Поэтому либо снимок с самой карты, либо честная строка о том,
 * что снимка нет.
 */
function MapPreview({ previewImage }: { previewImage?: string }) {
  if (!previewImage) {
    return (
      <View style={styles.mapFrame}>
        <View style={styles.mapFallback}>
          <Text style={styles.mapText}>
            Снимок карты не сохранён: карта не открывалась в этом проходе задания.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.mapFrame}>
      <Image src={previewImage} style={styles.mapImage} />
    </View>
  );
}

/** Расшифровка значков — те же контуры, что на карте и в маркерах. */
function WorkIconLegend({ result }: { result: Pz3Result }) {
  const items = getPz3IconKinds().flatMap((kind) => {
    const icon = getPz3WorkIcon(kind);
    // Линейные сооружения считаются по строкам, а переводы — штуками.
    const count = result.works
      .filter((work) => work.kind === kind)
      .reduce((sum, work) => sum + (kind === 'turnout' ? work.count ?? 0 : 1), 0);

    return icon && count > 0 ? [{ kind, icon, count }] : [];
  });

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={mapStyles.legend}>
      {items.map((item) => (
        <View key={item.kind} style={mapStyles.legendItem}>
          <Svg height={12} style={mapStyles.legendIcon} viewBox={`0 0 ${PZ3_ICON_GRID} ${PZ3_ICON_GRID}`} width={12}>
            {item.icon.paths.map((definition) => (
              <Path
                d={definition}
                key={definition}
                stroke={item.icon.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={PZ3_ICON_STROKE}
              />
            ))}
          </Svg>
          <Text style={mapStyles.legendText}>
            {item.icon.label} — {item.count}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Header({ section, summary }: { section: string; summary: Pz3PdfSummary }) {
  return (
    <View style={styles.runningHeader} fixed>
      <Text>
        Команда «{formatRequiredValue(summary.team)}» · ПЗ3 · {formatRequiredValue(summary.lineTitle)}
      </Text>
      <Text>{section}</Text>
    </View>
  );
}

function ResourceTable({ rows }: { rows: { title: string; unit: string; amount: number }[] }) {
  if (rows.length === 0) {
    return <Text style={styles.paragraph}>Нет позиций: работы без длины или количества в расход не идут.</Text>;
  }

  return (
    <View style={styles.table}>
        {rows.map((row) => (
          <View key={row.title} style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>{row.title}</Text>
            <Text style={styles.tableCellValue}>
              {formatAmount(row.amount)} {row.unit}
            </Text>
          </View>
      ))}
    </View>
  );
}

/** Этап работы по её принадлежности. Работа без этапа — это работа в пуле. */
function findStageTitle(result: Pz3Result, stageId: string | null) {
  if (stageId === null) {
    return 'не разнесена';
  }

  return result.stages.find((stage) => stage.id === stageId)?.title ?? 'не разнесена';
}

/** Сводка для преподавателя: счёт объектов отдельно от суммарного километража. */
export function summarizePz3Works(result: Pz3Result, labels: Record<string, string>): [string, string][] {
  const totals = new Map<string, { count: number; lengthKm: number; pieces: number }>();

  for (const work of result.works) {
    const item = totals.get(work.kind) ?? { count: 0, lengthKm: 0, pieces: 0 };
    item.count += 1;
    item.lengthKm += work.lengthKm ?? 0;
    item.pieces += work.count ?? 0;
    totals.set(work.kind, item);
  }

  if (totals.size === 0) return [['Работы', 'Не перечислены']];

  return [...totals.entries()]
    .sort(([left], [right]) => (labels[left] ?? left).localeCompare(labels[right] ?? right, 'ru'))
    .map(([kind, total]) => [
      labels[kind] ?? kind,
      kind === 'turnout'
        ? `${formatAmount(total.pieces)} шт.`
        : `${total.count} ${['bridge', 'tunnel', 'viaduct'].includes(kind) ? 'шт.' : 'уч.'} · ${formatAmount(total.lengthKm)} км`,
    ]);
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}
