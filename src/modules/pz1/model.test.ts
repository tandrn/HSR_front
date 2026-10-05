import { describe, expect, it } from 'vitest';
import {
  countFilledConsumerCells,
  createPz1Bridge,
  readPz1Position,
  isConsumerPropertiesComplete,
  validatePassportTeam,
  validateFinalIndicator,
  createInitialPz1Draft,
  createPz1Result,
  getPz1TaskStepCount,
  pz1StepIds,
  excludeTransportMode,
  getActiveTransportColumns,
  getActiveTransportModes,
  getExcludedTransportColumns,
  restoreTransportMode,
  createRouteLine,
  correspondenceTravelTimeRows,
  finalIndicators,
  getComputedFinalIndicators,
  discomfortRows,
  getEnabledStationRegions,
  getHsrTravelTimeResult,
  getPz1PassengerFlowForecast,
  getPz1CorrespondencePassengerFlowForecast,
  getPz1CorrespondenceScenarios,
  getPz1RegionalCharacteristics,
  getStationRouteDistances,
  getRouteMetrics,
  getSyncedCorrespondenceDetails,
  getEffectiveFareValues,
  getCarExistingFare,
  getCarForecastFare,
  getSyncedCorrespondenceTables,
  isFinalIndicatorsComplete,
  isStationsStepComplete,
  updateCellValue,
  transportColumns,
  validateAnnualFlowField,
  warnHsrSpeed,
  isHsrTravelTimeComplete,
  isAnnualFlowFieldLocked,
  validateConsumerCell,
  validateDiscomfortCell,
  validateOtherParameterField,
} from './model';

describe('pz1 model', () => {
  it('keeps routeLine independent from enabled station drafts', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'Москва', lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: 'Санкт-Петербург', lat: '59.9343', lng: '30.3351' };
    draft.routePointDrafts = [
      { id: 'route-point-1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
      { id: 'route-point-2', lat: '57.0000', lng: '34.0000', sagittaToNextKm: '20' },
      { id: 'route-point-3', lat: '59.9343', lng: '30.3351', sagittaToNextKm: '0' },
    ];

    const result = createPz1Result(draft);

    expect(result.stations).toHaveLength(2);
    expect(result.routeLine.vertices.map((vertex) => [vertex.lon, vertex.lat])).toEqual([
      [37.6173, 55.7558],
      [34, 57],
      [30.3351, 59.9343],
    ]);
    expect(result.routeLine.segments).toHaveLength(2);
    expect(result.routeLine.segments[1].sagittaKm).toBe(20);
    expect(result.totalLengthKm).toBeGreaterThan(0);
  });

  it('does not treat blank coordinates as zero coordinates', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'Москва', lat: '', lng: '' };

    const result = createPz1Result(draft);

    expect(result.stations).toHaveLength(0);
    expect(result.routeLine.vertices).toEqual([]);
  });

  it('accepts valid manual longitude values and rejects invalid coordinate ranges without crashing', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'Точка 111', lat: '55.7558', lng: '111' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: 'Финиш', lat: '59.9343', lng: '30.3351' };
    draft.routePointDrafts = [
      { id: 'route-point-1', lat: '55.7558', lng: '111', sagittaToNextKm: '0' },
      { id: 'route-point-2', lat: '59.9343', lng: '30.3351', sagittaToNextKm: '0' },
      { id: 'route-point-invalid', lat: '91', lng: 'text', sagittaToNextKm: '20' },
    ];

    const result = createPz1Result(draft);

    expect(result.stations).toHaveLength(2);
    expect(result.routeLine.vertices).toHaveLength(2);
    expect(result.routeLine.vertices[0].lon).toBe(111);
    expect(Number.isFinite(result.totalLengthKm)).toBe(true);
  });

  it('blocks station step when enabled station names are duplicated', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'Москва', lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: ' москва ', lat: '59.9343', lng: '30.3351' };
    draft.routePointDrafts = [
      { id: 'route-point-1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
      { id: 'route-point-2', lat: '59.9343', lng: '30.3351', sagittaToNextKm: '0' },
    ];

    expect(isStationsStepComplete(draft)).toBe(false);
  });

  it('calculates distances between neighboring stations along the route line', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'A', lat: '0', lng: '0' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: 'B', lat: '0', lng: '2' };
    draft.routePointDrafts = [
      { id: 'route-point-1', lat: '0', lng: '0', sagittaToNextKm: '0' },
      { id: 'route-point-2', lat: '0', lng: '1', sagittaToNextKm: '20' },
      { id: 'route-point-3', lat: '0', lng: '2', sagittaToNextKm: '0' },
    ];

    const [distance] = getStationRouteDistances(draft);

    expect(distance.fromLabel).toBe('А');
    expect(distance.toLabel).toBe('Г');
    expect(distance.distanceKm).toBeGreaterThan(222);
  });

  it('treats route segment bend input as radius in meters', () => {
    const routeLine = createRouteLine([
      { id: 'route-point-1', lat: '0', lng: '0', sagittaToNextKm: '0', bendM: '100000' },
      { id: 'route-point-2', lat: '0', lng: '1', sagittaToNextKm: '0', bendM: '0' },
    ]);

    expect(routeLine.segments[0].sagittaKm).toBeGreaterThan(10);
    expect(routeLine.segments[0].sagittaKm).toBeLessThan(20);
  });

  it('calculates HSR travel time from route segments and speed inputs', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'A', lat: '0', lng: '0' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: 'B', lat: '0', lng: '1' };
    draft.routePointDrafts = [
      { id: 'route-point-1', lat: '0', lng: '0', sagittaToNextKm: '0' },
      { id: 'route-point-2', lat: '0', lng: '1', sagittaToNextKm: '0' },
    ];
    draft.hsrTravelTimes = {
      'А-Г': { speedKmh: '120' },
    };

    const hsrTravelTime = getHsrTravelTimeResult(draft);

    expect(hsrTravelTime).not.toBeNull();
    expect(hsrTravelTime?.segments).toHaveLength(1);
    expect(hsrTravelTime?.totalMinutes).toBeGreaterThan(58);
  });

  it('updates nested table cells without mutating sibling rows', () => {
    const draft = createInitialPz1Draft();
    const [table] = getSyncedCorrespondenceTables(draft);
    const updated = updateCellValue(table.values, 'fare', 'hSR', '1200');

    expect(updated.fare.hSR).toBe('1200');
    expect(updated.travelTime.hSR).toBe('');
  });

  it('builds correspondence tables from enabled stations without losing existing pairs', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[1] = { ...draft.stationDrafts[1], enabled: true };

    const tables = getSyncedCorrespondenceTables(draft);

    expect(tables.map((table) => table.pairKey)).toEqual(['А-Б', 'А-Г', 'Б-Г']);
    expect(tables[0].activeModes).toContain('hSR');
  });

  it('keeps HSR in correspondence tables even if imported active modes exclude it', () => {
    const draft = createInitialPz1Draft();
    draft.correspondenceTables['А-Г'].activeModes = ['airplane'];

    const [table] = getSyncedCorrespondenceTables(draft);

    expect(table.activeModes).toEqual(['hSR', 'airplane']);
  });

  it('исключает вид транспорта из корреспонденции и возвращает его обратно (ТЗ v3.5 §4)', () => {
    const draft = createInitialPz1Draft();

    const withoutPlane = excludeTransportMode(draft, 'А-Г', 'airplane');
    expect(getActiveTransportColumns(withoutPlane, 'А-Г').map((column) => column.id)).not.toContain('airplane');
    expect(getExcludedTransportColumns(withoutPlane, 'А-Г').map((column) => column.id)).toEqual(['airplane']);

    const restored = restoreTransportMode(withoutPlane, 'А-Г', 'airplane');
    expect(getExcludedTransportColumns(restored, 'А-Г')).toEqual([]);
  });

  it('возвращает столбец на прежнее место, а не в конец таблицы', () => {
    const draft = createInitialPz1Draft();
    const order = getActiveTransportColumns(draft, 'А-Г').map((column) => column.id);

    const roundTrip = restoreTransportMode(excludeTransportMode(draft, 'А-Г', 'bus'), 'А-Г', 'bus');

    expect(getActiveTransportColumns(roundTrip, 'А-Г').map((column) => column.id)).toEqual(order);
  });

  it('не даёт исключить ВСМ — линия и есть предмет расчёта', () => {
    const draft = createInitialPz1Draft();

    const unchanged = excludeTransportMode(draft, 'А-Г', 'hSR');

    expect(getActiveTransportColumns(unchanged, 'А-Г').map((column) => column.id)).toContain('hSR');
    expect(getExcludedTransportColumns(unchanged, 'А-Г')).toEqual([]);
  });

  it('исключение вида снимает его с активных — модель получит по нему нули', () => {
    const draft = createInitialPz1Draft();

    const withoutBus = excludeTransportMode(draft, 'А-Г', 'bus');

    expect(getActiveTransportModes(withoutBus, 'А-Г')).not.toContain('bus');
    expect(getSyncedCorrespondenceTables(withoutBus)[0].activeModes).not.toContain('bus');
  });

  it('исключение вида транспорта переживает выгрузку в JSON-мост (DoD ТЗ v3.5 §4)', () => {
    const draft = createInitialPz1Draft();

    const withoutPlane = excludeTransportMode(draft, 'А-Г', 'airplane');
    const { consumerProperties } = createPz1Result(withoutPlane);

    expect(consumerProperties).toBeDefined();
    expect(consumerProperties?.['А-Г'].activeModes).not.toContain('airplane');
    expect(consumerProperties?.['А-Г'].activeModes).toContain('hSR');
  });

  it('идентификатор прохода заводится один раз и переживает выгрузку с загрузкой', () => {
    const draft = createInitialPz1Draft();
    const runId = draft.passport.runId;

    expect(runId).toMatch(/^\d{8}-\d{4}-[a-z0-9]{6}$/);

    const bridge = createPz1Bridge(draft);
    expect(bridge.passport.runId).toBe(runId);

    // Продолжение своей работы — тот же проход, id не меняется.
    expect(createInitialPz1Draft(bridge).passport.runId).toBe(runId);

    // Новый проход — новый id, иначе одинаковые работы было бы не различить.
    expect(createInitialPz1Draft().passport.runId).not.toBe(runId);
  });

  it('id прохода не завязан на название команды — его правят по ходу работы', () => {
    const draft = createInitialPz1Draft();
    const renamed = { ...draft, passport: { ...draft.passport, team: 'Другая команда' } };

    expect(createPz1Bridge(renamed).passport.runId).toBe(draft.passport.runId);
  });

  it('позиция шага в мосте адресуется стабильным id и переживает реордер (ФТ-23, ТЗ v3.6 T-2)', () => {
    const draft = createInitialPz1Draft();
    const bridge = createPz1Bridge(draft, { phase: 'task', stepId: 'station-other-parameters', theorySeen: true });

    expect(bridge.position?.pz1?.stepId).toBe('station-other-parameters');
    expect(readPz1Position(bridge)).toEqual({
      phase: 'task',
      stepIndex: pz1StepIds.indexOf('station-other-parameters'),
      theorySeen: true,
    });
  });

  it('файл без позиции и с незнакомым шагом открывается с интро, а не с чужого экрана', () => {
    const draft = createInitialPz1Draft();

    expect(readPz1Position(createPz1Bridge(draft))).toBeNull();
    expect(readPz1Position(createPz1Bridge(draft, { phase: 'task', stepId: 'consumer-properties' }))).toBeNull();
    expect(readPz1Position(createPz1Bridge(draft, { phase: 'intro', stepId: 'stations' }))).toBeNull();
    expect(readPz1Position(null)).toBeNull();
  });

  it('сохранение на итоге возвращает на итог', () => {
    const draft = createInitialPz1Draft();

    expect(readPz1Position(createPz1Bridge(draft, { phase: 'result' }))).toEqual({
      phase: 'result',
      stepIndex: pz1StepIds.length - 1,
      theorySeen: true,
    });
  });

  it('признак заполненности потребительских свойств зависит от корреспонденций', () => {
    // Регресс: проверялись correspondenceTables и discomfortMatrix от экрана,
    // которого больше нет, и в мосте всегда лежал false.
    const draft = createInitialPz1Draft();
    const [detail] = getSyncedCorrespondenceDetails(draft);

    const filled = {
      ...draft,
      correspondenceDetails: {
        ...draft.correspondenceDetails,
        [detail.pairKey]: {
          ...detail,
          travelTime: Object.fromEntries(
            correspondenceTravelTimeRows.map((row) => [
              row.id,
              Object.fromEntries(transportColumns.map((column) => [column.id, { existing: '00:40', forecast: '00:40' }])),
            ]),
          ) as typeof detail.travelTime,
        },
      },
    };

    expect(isConsumerPropertiesComplete(filled)).toBe(true);

    const broken = {
      ...filled,
      correspondenceDetails: {
        ...filled.correspondenceDetails,
        [detail.pairKey]: {
          ...filled.correspondenceDetails[detail.pairKey],
          travelTime: {
            ...filled.correspondenceDetails[detail.pairKey].travelTime,
            cleanTravel: {
              ...filled.correspondenceDetails[detail.pairKey].travelTime.cleanTravel,
              bus: { existing: '01:99', forecast: '00:40' },
            },
          },
        },
      },
    };

    expect(isConsumerPropertiesComplete(broken)).toBe(false);
  });

  it('счётчик заполненных ячеек смотрит в таблицы, которые заполняет студент', () => {
    // Регресс: счёт шёл по correspondenceTables и discomfortMatrix — их заполнял
    // экран «Потребительские свойства», которого в задании больше нет. В отчёте
    // всегда стоял 0, сколько бы студент ни ввёл.
    const draft = createInitialPz1Draft();
    const [detail] = getSyncedCorrespondenceDetails(draft);
    const before = countFilledConsumerCells(draft);

    // Частота автобуса по умолчанию пустая — на ней и видно, следит ли счётчик
    // за черновиком корреспонденции.
    const withBusFrequency = (bus: { existing: string; forecast: string }) => ({
      ...draft,
      correspondenceDetails: {
        ...draft.correspondenceDetails,
        [detail.pairKey]: { ...detail, frequency: { ...detail.frequency, bus } },
      },
    });

    expect(before).toBeGreaterThan(0);
    expect(countFilledConsumerCells(withBusFrequency({ existing: '8', forecast: '10' }))).toBe(before + 2);
    expect(countFilledConsumerCells(withBusFrequency({ existing: '8', forecast: '' }))).toBe(before + 1);
  });

  it('исключённый вид транспорта не идёт в счёт заполненных ячеек', () => {
    const draft = createInitialPz1Draft();
    const withoutBus = excludeTransportMode(draft, 'А-Г', 'bus');

    expect(countFilledConsumerCells(withoutBus)).toBeLessThan(countFilledConsumerCells(draft));
  });

  it('«Прочие параметры» стоят раньше «Частоты и стоимости» (ТЗ v3.6 T-2)', () => {
    const other = pz1StepIds.indexOf('station-other-parameters');
    const frequencyFare = pz1StepIds.indexOf('correspondence-frequency-fare');

    expect(other).toBeGreaterThanOrEqual(0);
    expect(other).toBeLessThan(frequencyFare);
    // Позиция 06 из 10 в подписи шага — индекс 5.
    expect(other).toBe(5);
    expect(frequencyFare).toBe(6);
  });

  it('счётчик шагов берётся из списка, а не зашит числом', () => {
    expect(getPz1TaskStepCount(createInitialPz1Draft())).toBe(pz1StepIds.length);
    expect(new Set(pz1StepIds).size).toBe(pz1StepIds.length);
  });

  it('название команды проверяется, учебная группа остаётся свободной (ТЗ v3.5 §3 П-01)', () => {
    expect(validatePassportTeam('')).toBe('Впишите название команды');
    expect(validatePassportTeam('  ')).toBe('Впишите название команды');
    expect(validatePassportTeam('Ю')).toBe('Не короче 2 символов');
    expect(validatePassportTeam('Ю'.repeat(41))).toBe('Не длиннее 40 символов');
    expect(validatePassportTeam('Юнит-3')).toBeNull();
  });

  it('вместимость ВСМ существующая залочена на 0 и не даёт ошибку (ТЗ v3.6 T-3)', () => {
    expect(isAnnualFlowFieldLocked('capacityExisting', 'hSR')).toBe(true);
    expect(isAnnualFlowFieldLocked('capacityForecast', 'hSR')).toBe(false);
    expect(isAnnualFlowFieldLocked('capacityExisting', 'bus')).toBe(false);

    // Пустое значение у ВСМ больше не блокирует переход.
    expect(validateAnnualFlowField('capacityExisting', '', 'hSR')).toBeNull();
    // У остальных видов поведение прежнее.
    expect(validateAnnualFlowField('capacityExisting', '', 'bus')).toBe('Заполните поле');

    const draft = createInitialPz1Draft();
    expect(getSyncedCorrespondenceDetails(draft)[0].annualFlows.hSR.capacityExisting).toBe('0');
  });

  it('предупреждает о скорости вне 50…400, но не блокирует (ТЗ v3.6 T-5)', () => {
    expect(warnHsrSpeed('12')).toBe('Скорость вне диапазона 50…400 км/ч — проверьте значение');
    expect(warnHsrSpeed('500')).toBe('Скорость вне диапазона 50…400 км/ч — проверьте значение');
    expect(warnHsrSpeed('300')).toBeNull();
    expect(warnHsrSpeed('50')).toBeNull();
    expect(warnHsrSpeed('400')).toBeNull();
    // Пустое и нечисловое — забота блокирующей проверки, не этой.
    expect(warnHsrSpeed('')).toBeNull();

    // Скорость 12 км/ч не должна мешать пройти шаг дальше.
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], lat: '57.6261', lng: '39.8845' };
    draft.routePointDrafts = [
      { id: 'p1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
      { id: 'p2', lat: '57.6261', lng: '39.8845', sagittaToNextKm: '0' },
    ];
    for (const distance of getStationRouteDistances(draft)) {
      draft.hsrTravelTimes[`${distance.fromLabel}-${distance.toLabel}`] = { speedKmh: '12' };
    }

    expect(isHsrTravelTimeComplete(draft)).toBe(true);
  });

  it('длина трассы и сумма участков между станциями совпадают (ТЗ v3.6 T-7)', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'Москва', lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[1] = { ...draft.stationDrafts[1], enabled: true, name: 'Переславль', lat: '56.7000', lng: '38.7000' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: 'Ярославль', lat: '57.6261', lng: '39.8845' };
    // Разная стрела прогиба по сегментам — общий коэффициент здесь бы соврал.
    draft.routePointDrafts = [
      { id: 'p1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '8' },
      { id: 'p2', lat: '56.7000', lng: '38.7000', sagittaToNextKm: '2' },
      { id: 'p3', lat: '57.6261', lng: '39.8845', sagittaToNextKm: '0' },
    ];

    const widgetLengthKm = getRouteMetrics(draft).totalLengthKm;
    const sumOfLegsKm = getStationRouteDistances(draft).reduce((sum, leg) => sum + leg.distanceKm, 0);

    expect(widgetLengthKm).toBeGreaterThan(0);
    // Раньше расхождение было ~0,06 % (ломаная короче дуги). Теперь мерная
    // лента одна, и сумма участков сходится с длиной трассы до метра.
    expect(sumOfLegsKm).toBeCloseTo(widgetLengthKm, 3);
  });

  it('прогнозная стоимость авто по умолчанию равна существующей и перебивается вводом', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], lat: '57.6261', lng: '39.8845' };
    draft.routePointDrafts = [
      { id: 'p1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
      { id: 'p2', lat: '57.6261', lng: '39.8845', sagittaToNextKm: '0' },
    ];

    const computed = getCarExistingFare(draft, 'А-Г');
    expect(computed).not.toBeNull();

    const detail = getSyncedCorrespondenceDetails(draft).find((item) => item.pairKey === 'А-Г');
    expect(detail).toBeDefined();

    const byDefault = getEffectiveFareValues(draft, detail!);
    // Рубли: два знака и запятая, а не сырое 4004.816259
    expect(byDefault.car.existing).toMatch(/^\d+,\d{2}$/);
    expect(byDefault.car.forecast).toBe(byDefault.car.existing);

    const edited = getEffectiveFareValues(draft, {
      ...detail!,
      fare: { ...detail!.fare, car: { ...detail!.fare.car, forecast: '5000' } },
    });
    expect(edited.car.forecast).toBe('5000');
    expect(edited.car.existing).toBe(byDefault.car.existing);
  });

  it('введённая прогнозная стоимость авто побеждает расчётную и идёт в расчёт', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], lat: '57.6261', lng: '39.8845' };
    draft.routePointDrafts = [
      { id: 'p1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
      { id: 'p2', lat: '57.6261', lng: '39.8845', sagittaToNextKm: '0' },
    ];
    const detail = getSyncedCorrespondenceDetails(draft).find((item) => item.pairKey === 'А-Г')!;
    const computed = getCarExistingFare(draft, 'А-Г');

    // Пусто — берётся расчётная.
    expect(getCarForecastFare(draft, detail)).toBeCloseTo(computed ?? -1, 6);

    // Введено — побеждает ввод, в том числе с запятой как разделителем.
    const edited = { ...detail, fare: { ...detail.fare, car: { ...detail.fare.car, forecast: '5500,50' } } };
    expect(getCarForecastFare(draft, edited)).toBeCloseTo(5500.5, 6);
  });

  it('расчётная стоимость авто не считается незаполненным полем', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], lat: '57.6261', lng: '39.8845' };
    draft.routePointDrafts = [
      { id: 'p1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
      { id: 'p2', lat: '57.6261', lng: '39.8845', sagittaToNextKm: '0' },
    ];
    const detail = getSyncedCorrespondenceDetails(draft).find((item) => item.pairKey === 'А-Г')!;

    // В сыром черновике у авто пусто — именно это раньше уходило в список
    // недостающих полей и не давало построить модель.
    expect(detail.fare.car.existing).toBe('');
    expect(getEffectiveFareValues(draft, detail).car.existing).not.toBe('');
  });

  it('прогнозная стоимость авто влияет на прогноз: дороже поездка — меньше доля авто', () => {
    const buildDraft = (carForecastFare: string) => {
      const draft = createInitialPz1Draft();
      draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'А', region: 'Москва', lat: '55.7558', lng: '37.6173' };
      draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: 'Г', region: 'Ярославская область', lat: '57.6261', lng: '39.8845' };
      draft.routePointDrafts = [
        { id: 'p1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
        { id: 'p2', lat: '57.6261', lng: '39.8845', sagittaToNextKm: '0' },
      ];
      draft.hsrTravelTimes = { 'А-Г': { speedKmh: '300' } };

      const regionParameters = {
        grpExisting: '1000000',
        grpForecast: '1200000',
        populationExisting: '12000',
        populationForecast: '12500',
        averageSalary: '90000',
        kGdpFlow: '0,9',
      };
      draft.regionalCharacteristics = {
        ...draft.regionalCharacteristics,
        regionA: 'Москва',
        regionB: 'Ярославская область',
        inducedDemandPct: '35',
        regionParameters: { 'Москва': regionParameters, 'Ярославская область': regionParameters },
      };

      const detail = { ...getSyncedCorrespondenceDetails(draft)[0] };
      for (const row of correspondenceTravelTimeRows) {
        for (const column of transportColumns) {
          detail.travelTime[row.id][column.id] = { existing: '1:00', forecast: '1:00' };
        }
      }
      for (const column of transportColumns) {
        detail.frequency[column.id] = { existing: '6', forecast: '6' };
        detail.fare[column.id] = { existing: '2500', forecast: '2500' };
        detail.annualFlows[column.id] = {
          capacity: '300',
          capacityExisting: '300',
          capacityForecast: '300',
          occupancyExisting: '0,8',
          occupancyForecast: '0,8',
        };
      }
      detail.fare.hSR = { existing: '0', forecast: '2500' };
      detail.annualFlows.hSR = { ...detail.annualFlows.hSR, capacityExisting: '0' };
      detail.fare.car = { existing: '', forecast: carForecastFare };
      draft.correspondenceDetails = { 'А-Г': detail };

      return draft;
    };

    const byDefault = getPz1CorrespondencePassengerFlowForecast(buildDraft(''), 'А-Г');
    const expensive = getPz1CorrespondencePassengerFlowForecast(buildDraft('12000'), 'А-Г');

    expect(byDefault).not.toBeNull();
    expect(expensive).not.toBeNull();

    const carByDefault = byDefault?.modes.find((mode) => mode.modeId === 'car');
    const carExpensive = expensive?.modes.find((mode) => mode.modeId === 'car');

    // Пустое поле — берётся расчётная стоимость; введённая дороже — доля авто падает.
    expect(carExpensive?.forecastShare ?? 1).toBeLessThan(carByDefault?.forecastShare ?? 0);
  });

  it('существующий поток авто = сумма остальных × 1,3 (документ заказчика)', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], name: 'А', region: 'Москва', lat: '55.7558', lng: '37.6173' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], name: 'Г', region: 'Ярославская область', lat: '57.6261', lng: '39.8845' };
    draft.routePointDrafts = [
      { id: 'p1', lat: '55.7558', lng: '37.6173', sagittaToNextKm: '0' },
      { id: 'p2', lat: '57.6261', lng: '39.8845', sagittaToNextKm: '0' },
    ];
    draft.hsrTravelTimes = { 'А-Г': { speedKmh: '300' } };
    const regionParameters = {
      grpExisting: '1000000',
      grpForecast: '1200000',
      populationExisting: '12000',
      populationForecast: '12500',
      averageSalary: '90000',
      kGdpFlow: '0,9',
    };
    draft.regionalCharacteristics = {
      ...draft.regionalCharacteristics,
      regionA: 'Москва',
      regionB: 'Ярославская область',
      inducedDemandPct: '35',
      regionParameters: { 'Москва': regionParameters, 'Ярославская область': regionParameters },
    };

    const detail = { ...getSyncedCorrespondenceDetails(draft)[0] };
    for (const row of correspondenceTravelTimeRows) {
      for (const column of transportColumns) {
        detail.travelTime[row.id][column.id] = { existing: '1:00', forecast: '1:00' };
      }
    }
    for (const column of transportColumns) {
      detail.frequency[column.id] = { existing: '6', forecast: '6' };
      detail.fare[column.id] = { existing: '2500', forecast: '2500' };
      detail.annualFlows[column.id] = {
        capacity: '300',
        capacityExisting: '300',
        capacityForecast: '300',
        occupancyExisting: '0,8',
        occupancyForecast: '0,8',
      };
    }
    detail.fare.hSR = { existing: '0', forecast: '2500' };
    detail.annualFlows.hSR = { ...detail.annualFlows.hSR, capacityExisting: '0' };
    draft.correspondenceDetails = { 'А-Г': detail };

    const forecast = getPz1CorrespondencePassengerFlowForecast(draft, 'А-Г');
    expect(forecast).not.toBeNull();

    const modes = forecast!.modes;
    const car = modes.find((mode) => mode.modeId === 'car')!;
    const others = modes
      .filter((mode) => mode.modeId !== 'car')
      .reduce((sum, mode) => sum + mode.existingAnnualFlow, 0);

    expect(others).toBeGreaterThan(0);
    expect(car.existingAnnualFlow).toBeCloseTo(others * 1.3, 3);
    // У ВСМ существующего потока нет.
    expect(modes.find((mode) => mode.modeId === 'hSR')!.existingAnnualFlow).toBe(0);
  });

  it('validates consumer properties by metric rules', () => {
    expect(validateDiscomfortCell('1,2')).toBe('Значение должно быть в диапазоне от 0 до 1');
    expect(validateConsumerCell('dailyFrequency', '-1')).toBe('Значение не может быть отрицательным');
    expect(validateConsumerCell('fare', '1200')).toBeNull();
  });

  it('fills annual flow from the passenger flow forecast', () => {
    const draft = createInitialPz1Draft();
    const existingAnnualFlow = 2_325_272.4;
    const expectedBaseForecast = 2_208_992.6;
    draft.passengerFlowForecast.regional = {
      grpCurrentRegionA: '1',
      grpCurrentRegionB: '0',
      grpGrowthPctRegionA: '0',
      grpGrowthPctRegionB: '0',
      populationCurrentRegionA: '1',
      populationCurrentRegionB: '0',
      populationGrowthPctRegionA: '0',
      populationGrowthPctRegionB: '0',
      gdpPassengerFlowCoefficientRegionA: String(expectedBaseForecast / existingAnnualFlow),
      gdpPassengerFlowCoefficientRegionB: '0',
      inducedDemandPct: '0.35',
    };
    draft.passengerFlowForecast.modes = {
      hSR: {
        existingAnnualFlow: '0',
        travelTimeHours: '2',
        waitingTimeHours: '0',
        totalTransportCost: '1000',
        existingTravelTimeHours: '3',
      },
      airplane: {
        existingAnnualFlow: '475856.4',
        travelTimeHours: '4',
        waitingTimeHours: '0.5',
        totalTransportCost: '1200',
        existingTravelTimeHours: '4',
      },
      bus: {
        existingAnnualFlow: '277052.3',
        travelTimeHours: '6',
        waitingTimeHours: '0.2',
        totalTransportCost: '800',
        existingTravelTimeHours: '6',
      },
      suburbanTrain: {
        existingAnnualFlow: '157820',
        travelTimeHours: '5',
        waitingTimeHours: '0.2',
        totalTransportCost: '700',
        existingTravelTimeHours: '5',
      },
      longDistanceTrain: {
        existingAnnualFlow: '165367',
        travelTimeHours: '5',
        waitingTimeHours: '0.3',
        totalTransportCost: '900',
        existingTravelTimeHours: '5',
      },
      car: {
        existingAnnualFlow: '1249176.7',
        travelTimeHours: '5',
        waitingTimeHours: '0',
        totalTransportCost: '1100',
        existingTravelTimeHours: '5',
      },
    };

    const expectedAnnualFlow = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(
      2_982_140,
    );

    expect(getComputedFinalIndicators(draft).annualFlow).toBe(expectedAnnualFlow);
    expect(createPz1Result(draft).finalIndicators?.annualFlow).toBe(expectedAnnualFlow);
  });

  it('does not require manual annual flow on the final indicators step', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], lat: '0', lng: '0' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], lat: '0', lng: '1' };
    draft.routePointDrafts = [
      { id: 'route-point-1', lat: '0', lng: '0', sagittaToNextKm: '0' },
      { id: 'route-point-2', lat: '0', lng: '1', sagittaToNextKm: '0' },
    ];
    draft.hsrTravelTimes = {
      'А-Г': { speedKmh: '200' },
    };
    draft.finalIndicators = finalIndicators.reduce<Record<string, string>>((values, indicator) => {
      if (indicator.id !== 'lineLength' && indicator.id !== 'annualFlow' && indicator.id !== 'travelTime') {
        values[indicator.id] = indicator.id === 'riskNotes' ? 'Данные требуют проверки' : '1';
      }
      return values;
    }, {});

    expect(getComputedFinalIndicators(draft).annualFlow).toBe('');
    expect(isFinalIndicatorsComplete(draft)).toBe(true);
  });

  it('fills final station count and annual flow from correspondence annual flow tables', () => {
    const draft = createInitialPz1Draft();
    draft.correspondenceTables['А-Г'].activeModes = ['hSR', 'airplane'];
    draft.correspondenceDetails['А-Г'] = {
      ...draft.correspondenceDetails['А-Г'],
      frequency: {
        ...draft.correspondenceDetails['А-Г'].frequency,
        hSR: { existing: '0', forecast: '8' },
        airplane: { existing: '3', forecast: '4' },
      },
      annualFlows: {
        ...draft.correspondenceDetails['А-Г'].annualFlows,
        hSR: {
          ...draft.correspondenceDetails['А-Г'].annualFlows.hSR,
          capacityForecast: '400',
          occupancyForecast: '0,5',
        },
        airplane: {
          ...draft.correspondenceDetails['А-Г'].annualFlows.airplane,
          capacityForecast: '120',
          occupancyForecast: '0,75',
        },
      },
    };

    const computed = getComputedFinalIndicators(draft);

    expect(getPz1PassengerFlowForecast(draft)).toBeNull();
    expect(computed.stationCount).toBe('2');
    expect(computed.annualFlow).toBe(new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(715_400));
    expect(createPz1Result(draft).finalIndicators?.annualFlow).toBe(computed.annualFlow);
  });

  it('derives total demand growth inputs from the regional characteristics screen', () => {
    const draft = createInitialPz1Draft();
    draft.regionalCharacteristics = {
      ...draft.regionalCharacteristics,
      grpExistingRegionA: '100',
      grpExistingRegionB: '100',
      grpForecastRegionA: '110',
      grpForecastRegionB: '110',
      populationExistingRegionA: '50',
      populationExistingRegionB: '50',
      populationForecastRegionA: '55',
      populationForecastRegionB: '55',
      averageSalaryRegionA: '60000',
      averageSalaryRegionB: '65000',
      kGdpFlowRegionA: '1',
      kGdpFlowRegionB: '1',
      inducedDemandPct: '35',
    };
    draft.passengerFlowForecast.modes = {
      hSR: {
        existingAnnualFlow: '0',
        travelTimeHours: '2',
        waitingTimeHours: '0',
        totalTransportCost: '1000',
        existingTravelTimeHours: '0',
      },
      airplane: {
        existingAnnualFlow: '100',
        travelTimeHours: '3',
        waitingTimeHours: '1',
        totalTransportCost: '2000',
        existingTravelTimeHours: '3',
      },
      bus: {
        existingAnnualFlow: '100',
        travelTimeHours: '5',
        waitingTimeHours: '0.5',
        totalTransportCost: '800',
        existingTravelTimeHours: '5',
      },
      suburbanTrain: {
        existingAnnualFlow: '100',
        travelTimeHours: '4',
        waitingTimeHours: '0.5',
        totalTransportCost: '700',
        existingTravelTimeHours: '4',
      },
      longDistanceTrain: {
        existingAnnualFlow: '100',
        travelTimeHours: '4',
        waitingTimeHours: '0.5',
        totalTransportCost: '900',
        existingTravelTimeHours: '4',
      },
      car: {
        existingAnnualFlow: '100',
        travelTimeHours: '5',
        waitingTimeHours: '0',
        totalTransportCost: '1100',
        existingTravelTimeHours: '5',
      },
    };

    const forecast = getPz1PassengerFlowForecast(draft);

    // В итоговом DOCX нет дополнительного удвоения «туда-обратно».
    expect(forecast?.totalDemand.baseForecast).toBeCloseTo(605, 1);
    expect(forecast?.totalDemand.inducedDemand).toBeCloseTo(211.75, 2);
  });

  it('keeps regional parameters by unique station region and repeats them for matching stations', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[1] = {
      ...draft.stationDrafts[1],
      enabled: true,
      name: 'Промежуточная',
      lat: '1',
      lng: '1',
      region: draft.stationDrafts[0].region,
    };
    draft.regionalCharacteristics = {
      ...draft.regionalCharacteristics,
      inducedDemandPct: '20',
      regionParameters: {
        [draft.stationDrafts[0].region]: {
          grpExisting: '100',
          grpForecast: '120',
          populationExisting: '50',
          populationForecast: '55',
          averageSalary: '60000',
          kGdpFlow: '1',
        },
        [draft.stationDrafts[3].region]: {
          grpExisting: '200',
          grpForecast: '220',
          populationExisting: '80',
          populationForecast: '84',
          averageSalary: '65000',
          kGdpFlow: '1,1',
        },
      },
    };

    const regional = getPz1RegionalCharacteristics(draft);

    expect(getEnabledStationRegions(draft.stationDrafts)).toHaveLength(2);
    expect(regional.regionParameters?.[draft.stationDrafts[1].region]?.grpExisting).toBe('100');
  });

  it('calculates annual flow with separate existing and forecast capacities', () => {
    const draft = createInitialPz1Draft();
    const [detail] = getSyncedCorrespondenceDetails(draft);
    draft.correspondenceDetails[detail.pairKey] = detail;
    draft.correspondenceDetails[detail.pairKey].annualFlows.airplane = {
      capacity: '',
      capacityExisting: '100',
      capacityForecast: '200',
      occupancyExisting: '0,5',
      occupancyForecast: '0,5',
    };
    draft.correspondenceDetails[detail.pairKey].frequency.airplane = {
      existing: '1',
      forecast: '2',
    };

    const scenario = getPz1CorrespondenceScenarios(draft)[detail.pairKey];

    expect(scenario.annualFlows.airplane.existingAnnualFlow).toBe(18_250);
    expect(scenario.annualFlows.airplane.forecastAnnualFlow).toBe(73_000);
  });

  it('validates block 3 numeric cells with domain limits', () => {
    expect(validateOtherParameterField('carOccupancy', '0')).toBe('Значение должно быть больше 0');
    expect(validateOtherParameterField('cityFareOrigin', '-1')).toBe('Значение не может быть отрицательным');
    expect(validateAnnualFlowField('occupancyForecast', '1,2')).toBe('Коэффициент должен быть в диапазоне 0…1');
    expect(validateAnnualFlowField('capacityForecast', '200')).toBeNull();
  });

  it('uses regional salary, frequency and discomfort when building correspondence TTC', () => {
    const draft = createInitialPz1Draft();
    draft.stationDrafts[0] = { ...draft.stationDrafts[0], lat: '0', lng: '0' };
    draft.stationDrafts[3] = { ...draft.stationDrafts[3], lat: '0', lng: '1' };
    draft.routePointDrafts = [
      { id: 'route-point-1', lat: '0', lng: '0', sagittaToNextKm: '0' },
      { id: 'route-point-2', lat: '0', lng: '1', sagittaToNextKm: '0' },
    ];
    draft.hsrTravelTimes = {
      'А-Г': { speedKmh: '200' },
    };
    draft.regionalCharacteristics = {
      ...draft.regionalCharacteristics,
      inducedDemandPct: '20',
      regionParameters: {
        [draft.stationDrafts[0].region]: {
          grpExisting: '100',
          grpForecast: '120',
          populationExisting: '50',
          populationForecast: '55',
          averageSalary: '60000',
          kGdpFlow: '1',
        },
        [draft.stationDrafts[3].region]: {
          grpExisting: '120',
          grpForecast: '144',
          populationExisting: '60',
          populationForecast: '66',
          averageSalary: '80000',
          kGdpFlow: '1',
        },
      },
    };

    const [detail] = getSyncedCorrespondenceDetails(draft);
    for (const row of correspondenceTravelTimeRows) {
      for (const column of transportColumns) {
        detail.travelTime[row.id][column.id] = {
          existing: row.id === 'cleanTravel' ? '02:00' : '00:10',
          forecast: row.id === 'cleanTravel' ? '01:30' : '00:10',
        };
      }
    }
    for (const column of transportColumns) {
      detail.frequency[column.id] = { existing: column.id === 'hSR' ? '0' : '2', forecast: column.id === 'car' ? '0' : '4' };
      detail.fare[column.id] = { existing: column.id === 'hSR' ? '0' : '1000', forecast: column.id === 'car' ? '0' : '1200' };
      detail.annualFlows[column.id] = {
        capacity: '',
        capacityExisting: '100',
        capacityForecast: '120',
        occupancyExisting: '0,5',
        occupancyForecast: '0,5',
      };
    }
    draft.correspondenceDetails[detail.pairKey] = detail;

    const baseForecast = getPz1CorrespondencePassengerFlowForecast(draft, detail.pairKey);
    expect(baseForecast).not.toBeNull();
    const baseAirplaneTtc = Number(baseForecast?.inputs.modes.airplane.totalTransportCost);

    // k1 — только «Чистое время поездки»; ожидание k2 считается
    // отдельно как 18 / частота. Доступ к вокзалу в k1 тоже не входит.
    expect(Number(baseForecast?.inputs.modes.airplane.travelTimeHours)).toBeCloseTo(1.5, 6);
    expect(Number(baseForecast?.inputs.modes.airplane.waitingTimeHours)).toBeCloseTo(4.5, 6);

    for (const row of discomfortRows.slice(0, 8)) {
      draft.correspondenceDetails[detail.pairKey].discomfortForecast.values[row.id].airplane = '1';
    }

    const highDiscomfortForecast = getPz1CorrespondencePassengerFlowForecast(draft, detail.pairKey);
    const highAirplaneTtc = Number(highDiscomfortForecast?.inputs.modes.airplane.totalTransportCost);

    expect(baseAirplaneTtc).toBeGreaterThan(1200);
    expect(highAirplaneTtc).toBeGreaterThan(baseAirplaneTtc);
  });
});

describe('технико-экономические показатели: почему не пускало к итогу', () => {
  // Значения с экрана заказчика 09.09: все поля заполнены, а переход закрыт.
  const filled: Partial<Record<(typeof finalIndicators)[number]['id'], string>> = {
    maxSpeed: '350',
    gauge: '1520',
    dailyTrains: '21',
    maxCapacity: '3 766 066',
    rollingStockNeed: '5',
    constructionCost: '644',
    rollingStockCost: '26,25',
    ticketRevenue: '16;20;27;34;45',
    riskNotes: 'Вместимость состава 460 пасс',
  };

  it('число с разделителями разрядов больше не ломает проверку', () => {
    // Поля сами ставят неразрывные пробелы, пока в них печатают: «3 766 066»
    // разбирался как NaN, и шаг не считался заполненным.
    expect(validateFinalIndicator('maxCapacity', '3 766 066', createInitialPz1Draft())).toBeNull();
    expect(validateFinalIndicator('maxCapacity', '3 766 066', createInitialPz1Draft())).toBeNull();
  });

  it('билетная выручка принимается списком по годам, как и просит подпись поля', () => {
    const draft = createInitialPz1Draft();

    expect(validateFinalIndicator('ticketRevenue', '16;20;27;34;45', draft)).toBeNull();
    expect(validateFinalIndicator('ticketRevenue', '16, 20, 27, 34, 45', draft)).toBeNull();
    expect(validateFinalIndicator('ticketRevenue', '16', draft)).toBeNull();
  });

  it('единицы измерения словами отклоняются с понятной причиной, а не молча', () => {
    const message = validateFinalIndicator('constructionCost', '644 млрд', createInitialPz1Draft());

    expect(message).toBe('Нужно число без единиц измерения, например 644');
  });

  it('пустое поле называет себя незаполненным', () => {
    expect(validateFinalIndicator('constructionCost', '', createInitialPz1Draft())).toBe(
      'Заполните это поле, чтобы продолжить',
    );
  });

  it('ноль и отрицательное значение не проходят', () => {
    expect(validateFinalIndicator('gauge', '0', createInitialPz1Draft())).toBe('Значение должно быть больше нуля');
    expect(validateFinalIndicator('gauge', '-5', createInitialPz1Draft())).toBe('Значение должно быть больше нуля');
  });

  it('на заполненных значениях заказчика шаг закрывается', () => {
    const draft = {
      ...createInitialPz1Draft(),
      finalIndicators: { ...createInitialPz1Draft().finalIndicators, ...filled },
    };
    const blocking = finalIndicators
      .map((indicator) => ({
        id: indicator.id,
        error: validateFinalIndicator(indicator.id, draft.finalIndicators[indicator.id] ?? '', draft),
      }))
      .filter((item) => item.error !== null)
      .map((item) => item.id);

    // Ни одно поле, которое студент вводит руками, больше не блокирует переход.
    expect(blocking).toEqual(expect.not.arrayContaining(Object.keys(filled)));
    // Остаются только показатели, которые считаются на других шагах.
    expect(blocking.every((id) => ['lineLength', 'stationCount', 'travelTime'].includes(id))).toBe(true);
  });
});
