import { describe, expect, it } from 'vitest';
import type { Pz1PassengerFlowResult } from '../bridge/schema';
import { createPz1PdfBlob, createPz1PdfSections, formatDistanceKm } from './render';

describe('pdf render', () => {
  it('creates Russian PZ1 report sections without placeholder text', () => {
    const sections = createPz1PdfSections({
      team: 'Бригада 7',
      lineTitle: 'Москва - Санкт-Петербург',
      variantTitle: 'Вариант 1',
      stationCount: 4,
      routePointCount: 7,
      totalLengthKm: 654.3,
      filledConsumerCells: 25,
      runId: '20260902-1917-ab12cd',
      filledIndicatorCount: 13,
      createdAt: '2026-07-12T00:00:00.000Z',
    });

    const text = sections.flatMap((section) => [section.title, ...section.rows.flat()]).join('\n');

    expect(text).toContain('1. Исходные данные');
    expect(text).toContain('Команда');
    expect(text).toContain('Бригада 7');
    expect(text).toContain('Учебная группа');
    expect(text).toContain('Москва - Санкт-Петербург');
    expect(text).toContain('Технико-экономические показатели');
    expect(text).toContain('13');
    expect(text).not.toContain('PZ1 MVP report');
    expect(text).not.toContain('TODO');
  });

  it('renders a full Russian PZ1 PDF blob with route and table data', async () => {
    const blob = await createPz1PdfBlob({
      team: 'Бригада 7',
      lineTitle: 'Москва - Санкт-Петербург',
      variantTitle: 'Вариант 1',
      stationCount: 2,
      routePointCount: 2,
      totalLengthKm: 654.3,
      filledConsumerCells: 4,
      runId: '20260902-1917-ef34gh',
      filledIndicatorCount: 2,
      createdAt: '2026-07-12T00:00:00.000Z',
      consumerProperties: {
        'А-Г': {
          pairKey: 'А-Г',
          activeModes: ['hSR'],
          values: {
            travelTime: { hSR: '3,5' },
            discomfort: { hSR: '0' },
            dailyFrequency: { hSR: '12' },
            fare: { hSR: '3200' },
          },
        },
      },
      finalIndicators: {
        annualFlow: '1200000',
      },
      routeLine: {
        vertices: [
          { id: 'route-point-1', lon: 37.6173, lat: 55.7558 },
          { id: 'route-point-2', lon: 30.3351, lat: 59.9343 },
        ],
        segments: [{ id: 'route-point-1-route-point-2', fromVertexId: 'route-point-1', toVertexId: 'route-point-2', sagittaKm: 0 }],
      },
      stations: [
        { label: 'А', name: 'Москва', lat: 55.7558, lng: 37.6173, type: 'terminal' },
        { label: 'Г', name: 'Санкт-Петербург', lat: 59.9343, lng: 30.3351, type: 'terminal' },
      ],
    });

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(10_000);
  });

  it('renders the stacked passenger flow chart in the PZ1 PDF', async () => {
    const modeFlows = [
      ['hSR', 0, 9_200_000],
      ['airplane', 1_800_000, 800_000],
      ['bus', 1_100_000, 1_700_000],
      ['suburbanTrain', 2_000_000, 900_000],
      ['longDistanceTrain', 500_000, 600_000],
      ['car', 9_000_000, 5_500_000],
    ] as const;
    const passengerFlowForecast = {
      totalDemand: {
        existingAnnualFlow: 14_400_000,
        baseForecast: 13_700_000,
        inducedDemand: 5_000_000,
        totalForecast: 18_700_000,
      },
      modes: modeFlows.map(([modeId, existingAnnualFlow, forecastAnnualFlow]) => ({
        modeId,
        existingAnnualFlow,
        forecastAnnualFlow,
        forecastShare: forecastAnnualFlow / 18_700_000,
      })),
    } as Pz1PassengerFlowResult;

    const blob = await createPz1PdfBlob({
      team: 'Бригада 7',
      lineTitle: 'Москва — Санкт-Петербург',
      variantTitle: 'Вариант 1',
      stationCount: 2,
      routePointCount: 2,
      totalLengthKm: 654.3,
      filledConsumerCells: 4,
      runId: '20260902-1917-chart',
      filledIndicatorCount: 2,
      createdAt: '2026-07-12T00:00:00.000Z',
      passengerFlowForecast,
    });

    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(10_000);
  });

  it('километры в отчёте округляются до 2 знаков (ТЗ v3.6 T-6)', () => {
    // На экране было 610,32, а в таблице перегонов PDF — 610,315.
    expect(formatDistanceKm(610.315)).toBe('610,32');
    expect(formatDistanceKm(246.2249)).toBe('246,22');
    expect(formatDistanceKm(100)).toBe('100');
  });
});
