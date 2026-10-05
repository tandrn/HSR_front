import { Font, StyleSheet, Text, View } from '@react-pdf/renderer';
import ptSerifRegular from '@fontsource/pt-serif/files/pt-serif-cyrillic-400-normal.woff?url';
import ptSerifItalic from '@fontsource/pt-serif/files/pt-serif-cyrillic-400-italic.woff?url';
import ptSerifBold from '@fontsource/pt-serif/files/pt-serif-cyrillic-700-normal.woff?url';
import ralewayMedium from '@fontsource/raleway/files/raleway-cyrillic-500-normal.woff?url';
import ralewayBold from '@fontsource/raleway/files/raleway-cyrillic-800-normal.woff?url';
import { formatGroupedNumber } from '../shared/lib/numberFormat';

/**
 * Общая часть отчётов: шрифты, стили и мелкие блоки вёрстки.
 *
 * Отчёты по ПЗ1 и ПЗ2 — документы одного курса и обязаны выглядеть одинаково.
 * Держать вторую копию стилей значило бы разъехаться на первой же правке, а
 * шрифты, зарегистрированные дважды, тянулись бы в сборку по второму разу.
 */
export const PAGE_SIZE = 'A4';
export const MARGIN_MM = 20;
/** Высота запасной схемы карты: снимок настоящей карты вставляется по ширине. */
export const PDF_MAP_HEIGHT = 135;
const runtimeProcess = (globalThis as { process?: { cwd: () => string; versions?: { node?: string } } }).process;

function resolveFontSource(source: string) {
  if (runtimeProcess?.versions?.node && source.startsWith('/node_modules/')) {
    return `${runtimeProcess.cwd()}${source}`;
  }

  return source;
}

Font.register({
  family: 'RalewayPdf',
  fonts: [
    { src: resolveFontSource(ralewayMedium), fontWeight: 500 },
    { src: resolveFontSource(ralewayBold), fontWeight: 800 },
  ],
});

Font.register({
  family: 'PtSerifPdf',
  fonts: [
    { src: resolveFontSource(ptSerifRegular), fontWeight: 400 },
    { src: resolveFontSource(ptSerifItalic), fontStyle: 'italic', fontWeight: 400 },
    { src: resolveFontSource(ptSerifBold), fontWeight: 700 },
  ],
});

export const styles = StyleSheet.create({
  page: {
    padding: `${MARGIN_MM}mm`,
    color: '#111111',
    fontFamily: 'PtSerifPdf',
    fontSize: 11.5,
    lineHeight: 1.35,
  },
  titleBlock: {
    marginBottom: 34,
    marginTop: 34,
    textAlign: 'center',
  },
  assignment: {
    fontFamily: 'RalewayPdf',
    fontSize: 14,
    fontWeight: 800,
    marginBottom: 8,
  },
  title: {
    fontFamily: 'RalewayPdf',
    fontSize: 18,
    fontWeight: 800,
  },
  sectionTitle: {
    color: '#3a288b',
    fontFamily: 'RalewayPdf',
    fontSize: 14,
    fontWeight: 800,
    marginBottom: 8,
    marginTop: 9,
  },
  contents: {
    marginTop: 32,
  },
  contentsLine: {
    marginBottom: 6,
  },
  runningHeader: {
    borderBottom: '1 solid #111111',
    color: '#3a288b',
    display: 'flex',
    flexDirection: 'row',
    fontFamily: 'RalewayPdf',
    fontSize: 9,
    fontWeight: 500,
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 6,
  },
  runningHeaderPrimary: {
    paddingRight: 8,
    width: '64%',
  },
  runningHeaderSection: {
    textAlign: 'right',
    width: '36%',
  },
  paragraph: {
    marginBottom: 10,
  },
  table: {
    borderLeft: '1 solid #111111',
    borderTop: '1 solid #111111',
    marginBottom: 10,
  },
  tableRow: {
    display: 'flex',
    flexDirection: 'row',
  },
  tableHeaderRow: {
    backgroundColor: '#f4f2fa',
    display: 'flex',
    flexDirection: 'row',
    fontWeight: 700,
  },
  tableCellLabel: {
    backgroundColor: '#f4f2fa',
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    fontWeight: 700,
    padding: 4,
    width: '40%',
  },
  tableCellValue: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '60%',
  },
  /* Ширины столбцов у таблиц с разным числом колонок: общие стили ячеек дают
     в сумме 78 %, из-за чего подложка шапки уходила правее данных и правый
     край таблицы выглядел рваным. */
  halfCell: {
    width: '50%',
  },
  /* «начально-конечная» — самая длинная подпись в таблице станций, ей нужен
     столбец пошире, иначе слово переносится по дефису. 12+25+21+21+21 = 100 %. */
  stationTypeWideCell: {
    width: '25%',
  },
  stationNarrowCell: {
    width: '21%',
  },
  /* Таблица времени хода: шесть столбцов, общие стили дают в сумме 136 %,
     из-за чего «Торможение, мин» наезжало на «Время». 16+17+16+15+20+16 = 100 %. */
  hsrSegmentCell: {
    width: '16%',
  },
  hsrDistanceCell: {
    width: '17%',
  },
  hsrSpeedCell: {
    width: '16%',
  },
  hsrAccelCell: {
    width: '15%',
  },
  hsrBrakeCell: {
    width: '20%',
  },
  hsrTimeCell: {
    width: '16%',
  },
  segmentIndexCell: {
    width: '10%',
  },
  segmentWideCell: {
    width: '30%',
  },
  stationLabelCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '12%',
  },
  stationTypeCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '21%',
  },
  stationNameCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '22%',
  },
  stationCoordCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '23%',
  },
  compactTableBlock: {
    marginBottom: 10,
  },
  compactTableTitle: {
    fontFamily: 'RalewayPdf',
    fontSize: 10,
    fontWeight: 800,
    marginBottom: 4,
  },
  compactTable: {
    borderLeft: '1 solid #111111',
    borderTop: '1 solid #111111',
  },
  compactHeaderRow: {
    backgroundColor: '#f4f2fa',
    display: 'flex',
    flexDirection: 'row',
    fontWeight: 700,
  },
  compactRow: {
    display: 'flex',
    flexDirection: 'row',
  },
  metricCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '28%',
  },
  modeCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    flexBasis: 0,
    flexGrow: 1,
    fontSize: 8.5,
    padding: 4,
  },
  flowModeCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '34%',
  },
  flowValueCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '27%',
  },
  flowShareCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '12%',
  },
  passengerFlowChartFrame: {
    backgroundColor: '#ffffff',
    border: '1 solid #d9e3ef',
    borderRadius: 6,
    marginBottom: 10,
    padding: 10,
  },
  passengerFlowChartTitle: {
    fontFamily: 'RalewayPdf',
    fontSize: 9,
    fontWeight: 700,
    marginBottom: 10,
    textAlign: 'center',
  },
  passengerFlowStackedChart: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  passengerFlowStackedColumn: {
    alignItems: 'center',
    width: '42%',
  },
  passengerFlowStackedTotal: {
    fontSize: 8,
    marginBottom: 3,
  },
  passengerFlowStackedArea: {
    alignItems: 'center',
    borderBottom: '1 solid #a5a5a5',
    height: 132,
    justifyContent: 'flex-end',
    width: '100%',
  },
  passengerFlowStackedPeriod: {
    fontFamily: 'RalewayPdf',
    fontSize: 8,
    marginTop: 5,
  },
  passengerFlowLegend: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    justifyContent: 'center',
  },
  passengerFlowLegendItem: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
    fontSize: 7,
    gap: 3,
    width: '30%',
  },
  passengerFlowLegendSwatch: {
    height: 7,
    width: 7,
  },
  formulaBox: {
    alignItems: 'center',
    border: '1 solid #111111',
    marginBottom: 12,
    padding: 10,
  },
  finalIndexCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '8%',
  },
  finalNameCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '52%',
  },
  finalValueCell: {
    borderBottom: '1 solid #111111',
    borderRight: '1 solid #111111',
    padding: 4,
    width: '40%',
  },
  caption: {
    fontSize: 10,
    fontStyle: 'italic',
    marginBottom: 4,
    textAlign: 'center',
  },
  mapFrame: {
    alignItems: 'center',
    backgroundColor: '#f2f6f3',
    border: '1 solid #d5dfd8',
    borderRadius: 6,
    /* Высота рамки не задана: её задаёт сам снимок, вставленный по ширине.
       Фиксированная высота растягивала бы карту под чужие пропорции —
       ровно то, из-за чего снимок переставал быть похож на карту. */
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 10,
    position: 'relative',
  },
  mapImage: {
    width: '100%',
  },
  mapFallback: {
    alignItems: 'center',
    height: PDF_MAP_HEIGHT,
    justifyContent: 'center',
    width: '100%',
  },
  mapOverlay: {
    height: '100%',
    left: 0,
    position: 'absolute',
    top: 0,
    width: '100%',
  },
  mapText: {
    color: '#555555',
    textAlign: 'center',
  },
});

export function KeyValueTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <View style={styles.table}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.tableRow}>
          <Text style={styles.tableCellLabel}>{label}</Text>
          <Text style={styles.tableCellValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export function formatRequiredValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? formatGroupedNumber(trimmed) : 'не заполнено';
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'не указана' : date.toLocaleDateString('ru-RU');
}
