import { describe, expect, it } from 'vitest';
import type { TransportModeId } from '../../bridge/schema';
import { distributePassengerFlowByMode, forecastTotalDemand } from './passengerFlow';
import {
  CAR_EXISTING_FLOW_MULTIPLIER,
  SERVICE_WINDOW_HOURS,
  passengerFlowModeIds,
  passengerFlowModeWeights,
  passengerFlowRetentionCoefficients,
} from './passengerFlowWeights';

const expectedForecastByMode: Record<TransportModeId, number> = {
  hSR: 1_588_309,
  airplane: 132_479,
  bus: 291_857,
  suburbanTrain: 85_470,
  longDistanceTrain: 219_183,
  car: 664_842,
};

describe('passenger flow forecast', () => {
  it('keeps the 18 modal split constants in one place', () => {
    expect(passengerFlowModeIds).toHaveLength(6);

    for (const modeId of passengerFlowModeIds) {
      const weights = passengerFlowModeWeights[modeId];

      expect(weights.time + weights.price + weights.comfort).toBeCloseTo(1, 8);
    }
  });

  it('calculates total demand growth from the Excel check values', () => {
    const existingAnnualFlow = 2_325_272.4;
    const expectedBaseForecast = 2_208_992.6;
    const forecast = forecastTotalDemand({
      existingAnnualFlow,
      grpCurrentRegionA: 1,
      grpCurrentRegionB: 0,
      grpGrowthPctRegionA: 0,
      grpGrowthPctRegionB: 0,
      populationCurrentRegionA: 1,
      populationCurrentRegionB: 0,
      populationGrowthPctRegionA: 0,
      populationGrowthPctRegionB: 0,
      gdpPassengerFlowCoefficientRegionA: expectedBaseForecast / existingAnnualFlow,
      gdpPassengerFlowCoefficientRegionB: 0,
      inducedDemandPct: 0.35,
    });

    expect(forecast.baseForecast).toBeCloseTo(2_208_992.6, 1);
    expect(forecast.inducedDemand).toBeCloseTo(773_147.4, 0);
    expect(forecast.totalForecast).toBeCloseTo(2_982_140, 0);
  });

  it('distributes forecast by 6 transport modes using the Excel check values', () => {
    const totalForecast = 2_982_140;
    const result = distributePassengerFlowByMode({
      existingAnnualFlow: 0,
      baseForecast: totalForecast,
      inducedDemand: 0,
      hsrTravelTimeHours: 1,
      modes: passengerFlowModeIds.map((modeId) => {
        const expectedShare = expectedForecastByMode[modeId] / totalForecast;
        const targetImpedance = 1 / expectedShare;

        return {
          modeId,
          existingAnnualFlow: 0,
          travelTimeHours: 1,
          waitingTimeHours: 0,
          totalTransportCost: Math.cbrt(targetImpedance) / 24,
          existingTravelTimeHours: 1,
        };
      }),
    });

    expect(Math.round(result.forecastTotal)).toBe(totalForecast);

    for (const mode of result.modes) {
      expect(Math.round(mode.forecastAnnualFlow)).toBe(expectedForecastByMode[mode.modeId]);
    }
  });

  it('коэффициенты удержания заданы заказчиком, а не выведены из весов', () => {
    expect(passengerFlowRetentionCoefficients).toEqual({
      hSR: 0,
      airplane: 0.7,
      bus: 0.7,
      suburbanTrain: 0.6,
      longDistanceTrain: 0.4,
      car: 0.5,
    });

    // Прежняя реконструкция 1 − max(вес) давала эти числа лишь у двух видов
    // из шести — фиксируем расхождение, чтобы её не вернули «как было».
    const reconstructed = (modeId: TransportModeId) => {
      const weights = passengerFlowModeWeights[modeId];
      return 1 - Math.max(weights.time, weights.price, weights.comfort);
    };
    const matching = passengerFlowModeIds.filter(
      (modeId) => Math.abs(reconstructed(modeId) - passengerFlowRetentionCoefficients[modeId]) < 1e-9,
    );

    expect(matching).toEqual(['suburbanTrain', 'car']);
  });

  it('константы наполняемости авто и периода обслуживания', () => {
    expect(CAR_EXISTING_FLOW_MULTIPLIER).toBe(1.3);
    expect(SERVICE_WINDOW_HOURS).toBe(18);
  });

  it('индуцированный спрос уходит целиком ВСМ, остальным ноль', () => {
    const result = distributePassengerFlowByMode({
      existingAnnualFlow: 500_000,
      baseForecast: 600_000,
      inducedDemand: 100_000,
      hsrTravelTimeHours: 2,
      modes: passengerFlowModeIds.map((modeId) => ({
        modeId,
        existingAnnualFlow: modeId === 'hSR' ? 0 : 100_000,
        travelTimeHours: 4,
        waitingTimeHours: 1,
        totalTransportCost: 2_000,
        existingTravelTimeHours: 5,
      })),
    });

    const hsr = result.modes.find((mode) => mode.modeId === 'hSR');

    expect(hsr?.inducedCapture).toBeCloseTo(100_000, 6);
    for (const mode of result.modes) {
      if (mode.modeId !== 'hSR') {
        expect(mode.inducedCapture).toBe(0);
      }
    }
    expect(result.inducedTotal).toBeCloseTo(100_000, 6);
  });

  it('удержание уровня 1 считается по коэффициенту заказчика', () => {
    const existingAnnualFlow = 1_000_000;
    const baseForecast = 2_000_000;
    const result = distributePassengerFlowByMode({
      existingAnnualFlow,
      baseForecast,
      inducedDemand: 0,
      hsrTravelTimeHours: 2,
      modes: passengerFlowModeIds.map((modeId) => ({
        modeId,
        // Весь существующий поток у автобуса, чтобы проверить коэффициент точно.
        existingAnnualFlow: modeId === 'bus' ? existingAnnualFlow : 0,
        travelTimeHours: 4,
        waitingTimeHours: 1,
        totalTransportCost: 2_000,
        existingTravelTimeHours: 5,
      })),
    });

    const bus = result.modes.find((mode) => mode.modeId === 'bus');

    // Итоговый DOCX задаёт уровень 1 как долю: 1,0 × 0,7.
    expect(bus?.directCapture).toBeCloseTo(0.7, 6);
  });

  it('исключённый вид даёт нули и остаётся строкой результата (ТЗ v3.6 T-1)', () => {
    const buildModes = (excludedModeId: TransportModeId | null) =>
      passengerFlowModeIds.map((modeId) => ({
        modeId,
        existingAnnualFlow: modeId === 'hSR' ? 0 : 100_000,
        travelTimeHours: 4,
        waitingTimeHours: 1,
        totalTransportCost: 2_000,
        existingTravelTimeHours: 5,
        ...(modeId === excludedModeId
          ? {
              existingAnnualFlow: 0,
              travelTimeHours: 0,
              waitingTimeHours: 0,
              totalTransportCost: 0,
              existingTravelTimeHours: 0,
              excluded: true,
            }
          : {}),
      }));

    const result = distributePassengerFlowByMode({
      existingAnnualFlow: 500_000,
      baseForecast: 600_000,
      inducedDemand: 100_000,
      hsrTravelTimeHours: 2,
      modes: buildModes('bus'),
    });

    const bus = result.modes.find((mode) => mode.modeId === 'bus');

    // Строка не исчезает из результата, но вклад нулевой во всех трёх слагаемых.
    expect(result.modes).toHaveLength(6);
    expect(bus).toBeDefined();
    expect(bus?.forecastAnnualFlow).toBe(0);
    expect(bus?.directCapture).toBe(0);
    expect(bus?.gravityCapture).toBe(0);
    expect(bus?.inducedCapture).toBe(0);
    expect(bus?.forecastShare).toBe(0);
  });

  it('исключение вида не пересчитывает доли остальных пропорционально (ТЗ v3.6 T-1)', () => {
    // Автобус с нулевыми входами против автобуса, помеченного excluded.
    // Числа остальных пяти видов должны совпасть: пометка не запускает
    // перераспределение, она лишь снимает проверки на положительность.
    const base = {
      existingAnnualFlow: 500_000,
      baseForecast: 600_000,
      inducedDemand: 100_000,
      hsrTravelTimeHours: 2,
    };
    const modeRow = (modeId: TransportModeId) => ({
      modeId,
      existingAnnualFlow: modeId === 'hSR' ? 0 : 100_000,
      travelTimeHours: 4,
      waitingTimeHours: 1,
      totalTransportCost: 2_000,
      existingTravelTimeHours: 5,
    });

    const withExcluded = distributePassengerFlowByMode({
      ...base,
      modes: passengerFlowModeIds.map((modeId) =>
        modeId === 'bus'
          ? { ...modeRow(modeId), existingAnnualFlow: 0, excluded: true }
          : modeRow(modeId),
      ),
    });
    const withoutBusRow = distributePassengerFlowByMode({
      ...base,
      modes: passengerFlowModeIds.filter((modeId) => modeId !== 'bus').map(modeRow),
    });

    for (const modeId of passengerFlowModeIds) {
      if (modeId === 'bus') {
        continue;
      }

      const excludedRun = withExcluded.modes.find((mode) => mode.modeId === modeId);
      const droppedRun = withoutBusRow.modes.find((mode) => mode.modeId === modeId);

      expect(excludedRun?.forecastAnnualFlow).toBeCloseTo(droppedRun?.forecastAnnualFlow ?? -1, 6);
    }
  });
});
