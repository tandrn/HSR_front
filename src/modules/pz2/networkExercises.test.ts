import { describe, expect, it } from 'vitest';
import {
  calculateCriticalPath,
  checkCriticalPathSubmission,
  createEmptyCriticalPathSubmission,
  matchCriticalPathSet,
} from '../../shared/lib/criticalPath';
import { pz2NetworkExercises } from './networkExercises';

describe('семь вариантов критического пути из упражнения заказчика', () => {
  const keys = [
    { id: 'repair', duration: 11, paths: [['A', 'C', 'E', 'G']], float: [0, 1, 0, 1, 0, 1, 0] },
    { id: 'ballast', duration: 15, paths: [['A', 'C', 'E', 'G']], float: [0, 2, 0, 2, 0, 2, 0] },
    { id: 'slab-earth', duration: 15, paths: [['B', 'D', 'E', 'G']], float: [3, 0, 3, 0, 0, 5, 0] },
    { id: 'slab-viaduct', duration: 14, paths: [['A', 'C', 'F', 'G']], float: [0, 1, 0, 1, 1, 0, 0] },
    { id: 'bridge', duration: 16, paths: [['A', 'C', 'E', 'G']], float: [0, 2, 0, 2, 0, 1, 0] },
    // В присланном ключе B и D имеют резерв 1, но обратный проход даёт 2.
    { id: 'tunnel', duration: 15, paths: [['A', 'C', 'F', 'G']], float: [0, 2, 0, 2, 1, 0, 0] },
    {
      id: 'turnout',
      duration: 15,
      // В ключе указан B–D–F–G, но таблица не содержит связи D→F.
      paths: [['A', 'C', 'F', 'G']],
      float: [0, 3, 0, 3, 3, 0, 0],
    },
  ];

  it.each(keys)('$id: срок, пути и резервы следуют из таблицы зависимостей', ({ id, duration, paths, float }) => {
    const exercise = pz2NetworkExercises.find((item) => item.id === id)!;
    const result = calculateCriticalPath(exercise.works);
    expect(result.durationDays).toBe(duration);
    expect(result.paths).toEqual(paths);
    expect(exercise.works.map((work) => result.timings[work.id].float)).toEqual(float);
    for (const work of exercise.works) {
      const timing = result.timings[work.id];
      expect(timing.earlyFinish - timing.earlyStart).toBe(work.durationDays);
      expect(timing.lateFinish - timing.lateStart).toBe(work.durationDays);
    }
  });

  it('проверяет полный набор путей, если в сети действительно два критических пути', () => {
    const expected = [['A', 'C', 'F', 'G'], ['B', 'D', 'F', 'G']];
    expect(matchCriticalPathSet('B-D-F-G; A-C-F-G', expected)).toBe(true);
    expect(matchCriticalPathSet('A → C → F → G', expected)).toBe(false);
    expect(matchCriticalPathSet('A-C-F-G; A-C-F-G', expected)).toBe(false);
  });

  it('проверяет обязательные ранние сроки, срок проекта и пути без раскрытия чисел в результате', () => {
    const result = calculateCriticalPath(pz2NetworkExercises[0].works);
    const submission = {
      ...createEmptyCriticalPathSubmission(),
      durationDays: '11',
      paths: 'A-C-E-G',
      timings: Object.fromEntries(
        Object.entries(result.timings).map(([id, timing]) => [
          id,
          {
            earlyStart: String(timing.earlyStart),
            earlyFinish: String(timing.earlyFinish),
            lateStart: '', lateFinish: '', float: '',
          },
        ]),
      ),
    };
    expect(checkCriticalPathSubmission(submission, result).coreCorrect).toBe(true);
    submission.durationDays = '1.1e1';
    expect(checkCriticalPathSubmission(submission, result).durationCorrect).toBe(false);
    submission.durationDays = '11';
    submission.timings.E.earlyStart = '7';
    const check = checkCriticalPathSubmission(submission, result);
    expect(check.coreCorrect).toBe(false);
    expect(check.earlyErrors).toEqual(['E:earlyStart']);
  });
});
