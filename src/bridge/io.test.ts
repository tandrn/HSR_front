import { describe, expect, it } from 'vitest';
import { createBridge, parseBridgeJson, serializeBridge } from './io';

describe('bridge io', () => {
  it('parses a bridge with supported schema version', () => {
    const bridge = createBridge({
      team: 'Группа 1',
      lineTitle: 'Тестовая линия',
      defaultVariant: 1,
      createdAt: '2026-07-10T00:00:00.000Z',
    });

    expect(bridge.schemaVersion).toBe('1.2');
    expect(parseBridgeJson(serializeBridge(bridge))).toEqual(bridge);
  });

  it('keeps backward compatibility with schema version 1.0', () => {
    const bridge = {
      schemaVersion: '1.0',
      passport: { team: 'Группа 1', lineTitle: 'Тестовая линия', createdAt: '2026-07-10T00:00:00.000Z' },
      completed: {},
    };

    expect(parseBridgeJson(JSON.stringify(bridge))).toEqual(bridge);
  });

  // Файл из ПЗ1, сохранённый до появления следующего модуля, открывается как раньше.
  it('keeps backward compatibility with schema version 1.1', () => {
    const bridge = {
      schemaVersion: '1.1',
      passport: { team: 'Группа 1', lineTitle: 'Тестовая линия', createdAt: '2026-07-10T00:00:00.000Z' },
      completed: { pz1: { totalLengthKm: 512.85 } },
    };

    expect(parseBridgeJson(JSON.stringify(bridge))).toEqual(bridge);
  });

  it('переносит данные из старого номера задания в ПЗ3', () => {
    const legacy = {
      schemaVersion: '1.2',
      passport: { team: 'Группа 1', lineTitle: 'Тестовая линия', createdAt: '2026-07-10T00:00:00.000Z' },
      completed: { pz2: { works: [{ id: 'work-1' }] } },
      progress: { pz2: { works: true } },
      position: { pz2: { phase: 'task', stepId: 'works' } },
    };

    const imported = parseBridgeJson(JSON.stringify(legacy));

    expect(imported.completed.pz3).toEqual(legacy.completed.pz2);
    expect(imported.progress?.pz3).toEqual(legacy.progress.pz2);
    expect(imported.position?.pz3).toEqual(legacy.position.pz2);
    expect(serializeBridge(imported)).not.toContain('"pz2"');
  });

  it('rejects broken JSON', () => {
    expect(() => parseBridgeJson('{')).toThrow('Файл повреждён');
  });

  it('говорит, что файл чужой, а не сыплет внутренними словами', () => {
    // Сообщение читает студент: ни «мост», ни «schemaVersion» ему ничего не
    // говорят, зато «Скачать JSON» он видел на экране итога.
    expect(() => parseBridgeJson(JSON.stringify({ hello: 'world' }))).toThrow('Это не файл задания');
    expect(() => parseBridgeJson(JSON.stringify({ hello: 'world' }))).toThrow('Скачать JSON');
  });

  it('rejects another schema version', () => {
    expect(() =>
      parseBridgeJson(
        JSON.stringify({
          schemaVersion: '2.0',
          passport: { team: 'A', lineTitle: 'B', createdAt: '2026-07-10T00:00:00.000Z' },
          completed: {},
        }),
      ),
    ).toThrow('Файл сохранён версией задания 2.0');
  });
});
