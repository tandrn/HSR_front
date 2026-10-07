import { useState } from 'react';
import { useModuleState } from '../../bridge/context';
import {
  calculateCriticalPath,
  checkCriticalPathSubmission,
  createEmptyCriticalPathSubmission,
} from '../../shared/lib/criticalPath';
import type { CriticalPathSubmission, CriticalPathTimingInput } from '../../shared/lib/criticalPath';
import { LevelingExercise } from './LevelingExercise';
import { pz2NetworkExercises } from './networkExercises';
import type { Pz2NetworkExercise } from './networkExercises';
import type { Pz2Draft } from './types';

const timingLabels = {
  earlyStart: 'РН',
  earlyFinish: 'РО',
  lateStart: 'ПН',
  lateFinish: 'ПО',
  float: 'Р',
} as const;

export function ExercisesStep() {
  return (
    <div className="exercises-step">
      <CriticalPathExercises />
      <LevelingExercise />
    </div>
  );
}

function CriticalPathExercises() {
  const { draft, updateDraft } = useModuleState<Pz2Draft>();
  const [selectedId, setSelectedId] = useState(pz2NetworkExercises[0].id);
  const [checked, setChecked] = useState(false);
  const [showNetwork, setShowNetwork] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const exercise = pz2NetworkExercises.find((item) => item.id === selectedId)!;
  const expected = calculateCriticalPath(exercise.works);
  const submission = draft.criticalPathAnswers[exercise.id] ?? createEmptyCriticalPathSubmission();
  const check = checkCriticalPathSubmission(submission, expected);
  const solved = pz2NetworkExercises.filter((item) => {
    const answer = draft.criticalPathAnswers[item.id];
    return answer && checkCriticalPathSubmission(answer, calculateCriticalPath(item.works)).coreCorrect;
  }).length;

  function updateSubmission(change: (current: CriticalPathSubmission) => CriticalPathSubmission) {
    setChecked(false);
    updateDraft((current) => ({
      ...current,
      criticalPathAnswers: {
        ...current.criticalPathAnswers,
        [exercise.id]: change(current.criticalPathAnswers[exercise.id] ?? createEmptyCriticalPathSubmission()),
      },
    }));
  }

  function updateTiming(workId: string, field: keyof CriticalPathTimingInput, value: string) {
    updateSubmission((current) => {
      const timing = current.timings[workId] ?? {
        earlyStart: '', earlyFinish: '', lateStart: '', lateFinish: '', float: '',
      };
      return {
        ...current,
        timings: { ...current.timings, [workId]: { ...timing, [field]: value } },
      };
    });
  }

  return (
    <section className="form-section critical-path">
      <div className="osm-map-card__head">
        <div>
          <h3>Поиск критического пути</h3>
        </div>
        <span className="critical-path__counter">Решено {solved} из {pz2NetworkExercises.length}</span>
      </div>
      <p className="status-note">
        Каждый вариант — отдельный мини-проект. День 0 — начало; работа стартует после всех предшественников.
        Ресурсные ограничения здесь не учитываются. Сначала найдите ранние сроки, затем срок проекта и все критические пути.
      </p>

      <div className="critical-path__chooser">
        <label htmlFor="pz2-network-variant">Вариант</label>
        <select
          id="pz2-network-variant"
          onChange={(event) => {
            setSelectedId(event.target.value);
            setChecked(false);
            setShowNetwork(false);
            setShowOptional(false);
          }}
          value={selectedId}
        >
          {pz2NetworkExercises.map((item, index) => (
            <option key={item.id} value={item.id}>{String(index + 1).padStart(2, '0')} · {item.title}</option>
          ))}
        </select>
        <button
          aria-expanded={showNetwork}
          className="button button--outline"
          onClick={() => setShowNetwork((value) => !value)}
          type="button"
        >
          {showNetwork ? 'Скрыть сеть' : 'Показать сеть'}
        </button>
      </div>

      {showNetwork ? <NetworkDiagram exercise={exercise} /> : null}

      <div className="critical-path__table-wrap">
        <table className="critical-path__table">
          <caption>Работы варианта · сроки в условных рабочих днях</caption>
          <thead>
            <tr>
              <th scope="col">Код</th>
              <th scope="col">Работа</th>
              <th scope="col">Дни</th>
              <th scope="col">После</th>
              <th scope="col"><abbr title="Раннее начало">РН</abbr></th>
              <th scope="col"><abbr title="Раннее окончание">РО</abbr></th>
              {showOptional ? (
                <>
                  <th scope="col"><abbr title="Позднее начало">ПН</abbr></th>
                  <th scope="col"><abbr title="Позднее окончание">ПО</abbr></th>
                  <th scope="col"><abbr title="Полный резерв">Р</abbr></th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {exercise.works.map((work) => (
              <tr key={work.id}>
                <th scope="row">{work.id}</th>
                <td>{work.title}</td>
                <td className="numeric">{work.durationDays}</td>
                <td>{work.predecessors.join(', ') || '—'}</td>
                {(['earlyStart', 'earlyFinish', ...(showOptional ? ['lateStart', 'lateFinish', 'float'] : [])] as (keyof CriticalPathTimingInput)[])
                  .map((field) => (
                    <td key={field}>
                      <input
                        aria-label={`${timingLabels[field]} работы ${work.id}`}
                        className="critical-path__number"
                        inputMode="numeric"
                        min="0"
                        onChange={(event) => updateTiming(work.id, field, event.target.value)}
                        type="number"
                        value={submission.timings[work.id]?.[field] ?? ''}
                      />
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        aria-expanded={showOptional}
        className="critical-path__extra"
        onClick={() => setShowOptional((value) => !value)}
        type="button"
      >
        {showOptional ? 'Скрыть поздние сроки и резерв' : 'Дополнительно: поздние сроки и полный резерв'}
      </button>

      <div className="critical-path__answer">
        <label>
          Минимальный срок проекта, дней
          <input
            inputMode="numeric"
            min="0"
            onChange={(event) => updateSubmission((current) => ({ ...current, durationDays: event.target.value }))}
            type="number"
            value={submission.durationDays}
          />
        </label>
        <label>
          Критический путь или пути
          <input
            onChange={(event) => updateSubmission((current) => ({ ...current, paths: event.target.value }))}
            placeholder="A–C–E–G; второй путь через ;"
            type="text"
            value={submission.paths}
          />
        </label>
      </div>
      <p className="critical-path__hint">Пишите коды работ по порядку. Если путей несколько, разделите их точкой с запятой.</p>

      <div className="critical-path__question">
        <strong>Вопрос варианта</strong>
        <p>{exercise.question}</p>
        <label>
          Объяснение для преподавателя
          <textarea
            onChange={(event) => updateSubmission((current) => ({ ...current, reasoning: event.target.value }))}
            placeholder="Обоснуйте ответ сроками и резервами работ"
            value={submission.reasoning}
          />
        </label>
        <small>Объяснение сохранится в JSON; автоматически проверяются только числовые сроки и набор путей.</small>
      </div>

      <div className="critical-path__actions">
        <button className="button button--primary" onClick={() => setChecked(true)} type="button">Проверить</button>
        {checked ? <CheckMessage check={check} showOptional={showOptional} /> : null}
      </div>
    </section>
  );
}

function CheckMessage({
  check,
  showOptional,
}: {
  check: ReturnType<typeof checkCriticalPathSubmission>;
  showOptional: boolean;
}) {
  const messages: string[] = [];
  if (!check.earlyComplete) messages.push('Заполните РН и РО у всех работ.');
  if (check.earlyErrors.length > 0) {
    const codes = [...new Set(check.earlyErrors.map((error) => error.split(':')[0]))];
    messages.push(`Проверьте ранние сроки работ ${codes.join(', ')}: начало зависит от самого позднего окончания предшественников.`);
  }
  if (!check.durationCorrect) messages.push('Проверьте срок проекта: он равен окончанию последней работы.');
  if (!check.pathsCorrect) messages.push('Проверьте цепочки с нулевым полным резервом. В сети может быть больше одного критического пути.');
  if (showOptional && check.optionalErrors.length > 0) {
    const codes = [...new Set(check.optionalErrors.map((error) => error.split(':')[0]))];
    messages.push(`Проверьте поздние сроки или резерв работ ${codes.join(', ')}.`);
  }

  return (
    <p aria-live="polite" className={check.coreCorrect && messages.length === 0 ? 'status-note' : 'field-warning'}>
      {messages.length > 0
        ? messages.join(' ')
        : check.coreCorrect
          ? 'Верно: срок, ранние сроки и все критические пути совпали.'
          : 'Проверьте заполненные значения.'}
      {showOptional && !check.optionalComplete ? ' Дополнительные поля можно заполнить для самопроверки.' : ''}
    </p>
  );
}

function NetworkDiagram({ exercise }: { exercise: Pz2NetworkExercise }) {
  const positions: Record<string, [number, number]> = {
    A: [72, 70], B: [72, 230], C: [255, 70], D: [255, 230],
    E: [445, 105], F: [445, 245], G: [640, 175],
  };
  const links = exercise.works.flatMap((work) => work.predecessors.map((from) => [from, work.id] as const));

  return (
    <div className="critical-path__network">
      <svg aria-label="Схема зависимостей работ" role="img" viewBox="0 0 720 310">
        <defs>
          <marker id="pz2-network-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="8" refY="4">
            <path d="M0 0 L8 4 L0 8 Z" fill="var(--primary)" />
          </marker>
        </defs>
        {links.map(([from, to]) => {
          const [x1, y1] = positions[from];
          const [x2, y2] = positions[to];
          return (
            <line
              key={`${from}-${to}`}
              markerEnd="url(#pz2-network-arrow)"
              stroke="var(--primary)"
              strokeWidth="2"
              x1={x1 + 34}
              x2={x2 - 36}
              y1={y1}
              y2={y2}
            />
          );
        })}
        {exercise.works.map((work) => {
          const [x, y] = positions[work.id];
          return (
            <g key={work.id}>
              <rect fill="var(--bg-soft)" height="54" rx="8" stroke="var(--border-strong)" width="68" x={x - 34} y={y - 27} />
              <text className="critical-path__node-code" textAnchor="middle" x={x} y={y - 2}>{work.id}</text>
              <text className="critical-path__node-days" textAnchor="middle" x={x} y={y + 17}>{work.durationDays} дн.</text>
            </g>
          );
        })}
      </svg>
      <p>Стрелка означает, что следующая работа ждёт окончания предыдущей.</p>
    </div>
  );
}
