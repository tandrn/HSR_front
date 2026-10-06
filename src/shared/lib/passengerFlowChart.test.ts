import { describe, expect, it } from 'vitest';
import type { Pz1PassengerFlowResult } from '../../bridge/schema';
import { buildPassengerFlowStackedData, passengerFlowChartModes } from './passengerFlowChart';

describe('passenger flow stacked chart', () => {
  it('shows two periods with the same six transport layers', () => {
    const forecast = {
      modes: [
        { modeId: 'hSR', existingAnnualFlow: 0, forecastAnnualFlow: 700 },
        { modeId: 'airplane', existingAnnualFlow: 200, forecastAnnualFlow: 100 },
        { modeId: 'bus', existingAnnualFlow: 150, forecastAnnualFlow: 50 },
        { modeId: 'suburbanTrain', existingAnnualFlow: 100, forecastAnnualFlow: 80 },
        { modeId: 'longDistanceTrain', existingAnnualFlow: 50, forecastAnnualFlow: 70 },
        { modeId: 'car', existingAnnualFlow: 500, forecastAnnualFlow: 200 },
      ],
    } as Pz1PassengerFlowResult;

    const data = buildPassengerFlowStackedData(forecast);

    expect(data.map((row) => row.period)).toEqual(['Существующие', 'Прогноз']);
    expect(passengerFlowChartModes.map((mode) => mode.id)).toEqual([
      'hSR', 'airplane', 'longDistanceTrain', 'bus', 'suburbanTrain', 'car',
    ]);
    expect(passengerFlowChartModes.find((mode) => mode.id === 'hSR')?.color).toBe('#D64545');
    expect(Math.abs(
      passengerFlowChartModes.findIndex((mode) => mode.id === 'longDistanceTrain') -
      passengerFlowChartModes.findIndex((mode) => mode.id === 'suburbanTrain'),
    )).toBeGreaterThan(1);
    expect(passengerFlowChartModes.reduce((sum, mode) => sum + Number(data[0][mode.id]), 0)).toBe(1000);
    expect(passengerFlowChartModes.reduce((sum, mode) => sum + Number(data[1][mode.id]), 0)).toBe(1200);
    expect(data[0].hSR).toBe(0);
    expect(data[1].hSR).toBe(700);
  });
});
