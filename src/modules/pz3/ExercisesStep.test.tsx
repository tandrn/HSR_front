import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NetworkDiagram } from './ExercisesStep';
import { pz3NetworkExercises } from './networkExercises';

describe('схема сети в упражнении на критический путь', () => {
  it.each(pz3NetworkExercises)('$title открывается без ошибки и показывает все работы', (exercise) => {
    const markup = renderToStaticMarkup(<NetworkDiagram exercise={exercise} />);

    expect(markup).toContain('Схема зависимостей работ');
    for (const work of exercise.works) {
      expect(markup).toContain(`>${work.id}</text>`);
    }
    expect((markup.match(/<line /g) ?? [])).toHaveLength(
      exercise.works.reduce((count, work) => count + work.predecessors.length, 0),
    );
  });
});
