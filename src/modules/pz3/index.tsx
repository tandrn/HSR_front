import { useState } from 'react';
import { ModuleStateProvider, useModuleState } from '../../bridge/context';
import { jsonFileDraftStorage } from '../../bridge/storage';
import { ModuleShell } from '../../shared/ui/ModuleShell';
import type { ModuleTaskStep } from '../../shared/ui/ModuleShell';
import { ExercisesStep } from './ExercisesStep';
import { PlanStep } from './PlanStep';
import { StagesStep } from './StagesStep';
import { WorksStep } from './WorksStep';
import { getPz3OptionLabel } from './options';
import {
  createInitialPz3Draft,
  createPz3Bridge,
  formatPz3Km,
  getPz3LengthCheck,
  getPz3ExercisesProgress,
  getPz3RouteSource,
  getPz3SegmentMarks,
  getPz3StageWorks,
  isPz3PlanComplete,
  isPz3ExercisesComplete,
  isPz3StagesComplete,
  isPz3WorksComplete,
  pz3StepIds,
  pz3WorkKinds,
  readPz3Position,
} from './model';
import { getPz3Plan, getPz3Report } from './plan';
import type { Pz3Draft } from './types';

export function Pz3Module() {
  return (
    <ModuleStateProvider<Pz3Draft> initialDraft={createInitialPz3Draft()}>
      <Pz3Workspace />
    </ModuleStateProvider>
  );
}

function Pz3Workspace() {
  const { currentStepIndex, draft, importedBridge, phase, theorySeen } = useModuleState<Pz3Draft>();
  const source = getPz3RouteSource(importedBridge);

  const taskSteps: ModuleTaskStep[] = [
    {
      id: 'works',
      title: 'Работы по трассе',
      goal:
        'Пройдите линейкой по трассе и перечислите работы, которые нужно выполнить: их тип, длину и условия грунта. Сумма длин должна сойтись с длиной маршрута.',
      content: <WorksStep />,
      isComplete: isPz3WorksComplete(draft),
      completionHint: 'Добавьте хотя бы одну работу и заполните её длину или количество',
    },
    {
      id: 'stages',
      title: 'Разбиение на этапы',
      goal:
        'Разделите трассу на участки, которые строятся параллельно, и разнесите работы по ним: перетащите карточку работы в этап.',
      content: <StagesStep />,
      isComplete: isPz3StagesComplete(draft),
      completionHint: describeStagesHint(draft),
    },
    {
      id: 'exercises',
      title: 'Упражнения',
      goal:
        'Определите критический путь по сетевой диаграмме и разберитесь, как резервы работ позволяют выровнять число занятых людей во времени.',
      content: <ExercisesStep />,
      isComplete: isPz3ExercisesComplete(draft),
      completionHint: describeExercisesHint(draft),
    },
    {
      id: 'plan',
      title: 'Ресурсный график',
      goal:
        'Распределите рабочих по этапам так, чтобы потребность в людях была ровной: этапы строятся параллельно, и от раскладки зависят и срок, и загрузка.',
      content: <PlanStep />,
      isComplete: isPz3PlanComplete(draft),
      completionHint: 'Укажите общее число рабочих и назначьте людей на каждый этап',
    },
  ];

  return (
    <ModuleShell
      intro={<Pz3IntroStep />}
      introComplete={source.routeLine !== null}
      introCompletionHint="Загрузите файл, сохранённый в ПЗ1, — из него берутся трасса и длина маршрута"
      onSaveDraft={() =>
        jsonFileDraftStorage.save(
          // Позиция пишется стабильным id шага — как в ПЗ1: файл, сохранённый
          // до перестановки шагов, откроет тот же экран, а не тот же номер.
          createPz3Bridge(draft, importedBridge, {
            phase,
            stepId: pz3StepIds[currentStepIndex],
            theorySeen,
          }),
          'vsm-pz3-bridge.json',
        )
      }
      result={<Pz3ResultStep />}
      subtitle="Практическое задание № 3"
      taskSteps={taskSteps}
      theory={<Pz3TheoryStep />}
      title="Календарно-сетевой график строительства"
    />
  );
}

/** Сколько сегментов перенеслось и сколько из них кривые — видно сразу на интро. */
function describeSegments(segments: ReturnType<typeof getPz3SegmentMarks>) {
  const curves = segments.filter((segment) => segment.radiusM !== null).length;

  return curves > 0 ? `${segments.length}, из них кривых ${curves}` : String(segments.length);
}

function describeStagesHint(draft: Pz3Draft) {
  if (draft.stages.length === 0) {
    return 'Создайте хотя бы один этап';
  }

  const left = getPz3StageWorks(draft, null).length;

  return left > 0 ? `В пуле осталось работ: ${left}` : 'Добавьте работы на предыдущем шаге';
}

function describeExercisesHint(draft: Pz3Draft) {
  const progress = getPz3ExercisesProgress(draft);

  if (progress.solvedCriticalPath < progress.totalCriticalPath) {
    return `Решите все варианты критического пути: ${progress.solvedCriticalPath} из ${progress.totalCriticalPath}`;
  }

  return progress.levelingSolved
    ? 'Оба упражнения выполнены'
    : 'Выровняйте загрузку: дней с нехваткой должно остаться 0';
}

function Pz3IntroStep() {
  const { importedBridge, replaceDraft, setCurrentStepIndex, setImportedBridge, setTheorySeen } =
    useModuleState<Pz3Draft>();
  const [importError, setImportError] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const source = getPz3RouteSource(importedBridge);

  async function importBridgeFile(file: File) {
    try {
      const bridge = await jsonFileDraftStorage.load(file);

      if (!bridge.completed?.pz1?.routeLine) {
        setImportedBridge(null);
        setImportStatus('');
        setImportError('В этом файле нет трассы из ПЗ1. Загрузите файл, сохранённый в первом задании.');
        return;
      }

      setImportedBridge(bridge);
      // Возвращаем и данные, и место, на котором студент сохранился: файл ПЗ3
      // открывает тот же экран с уже введёнными работами и этапами.
      replaceDraft(createInitialPz3Draft(bridge));
      setImportError('');

      const position = readPz3Position(bridge);

      if (position) {
        // Фазу не переключаем — студент остаётся на интро и возвращается в
        // задание сам, как и в ПЗ1.
        setTheorySeen(position.theorySeen);
        setCurrentStepIndex(position.stepIndex);
        setImportStatus(
          `Загружен файл: ${file.name}. «Начать» вернёт на шаг ${position.stepIndex + 1} из ${pz3StepIds.length}.`,
        );
        return;
      }

      setImportStatus(`Загружен файл: ${file.name}`);
    } catch (error) {
      setImportStatus('');
      setImportError(error instanceof Error ? error.message : 'Не удалось загрузить файл.');
    }
  }

  return (
    <div className="intro-layout">
      <section className="form-section">
        <p className="eyebrow">Исходные данные</p>
        <h2>Трасса из первого задания</h2>
        <p>
          Третье задание использует трассу из первого: работы считаются по той линии ВСМ, которую вы уже проложили. Загрузите файл,
          сохранённый в ПЗ1, — из него берутся сама трасса и длина маршрута.
        </p>
        <label
          className="drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files.item(0);
            if (file) {
              void importBridgeFile(file);
            }
          }}
        >
          <input
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.item(0);
              if (file) {
                void importBridgeFile(file);
              }
              event.currentTarget.value = '';
            }}
            type="file"
          />
          <span>Выберите JSON-файл ПЗ1 или перенесите его сюда</span>
        </label>
        {importStatus ? <p className="status-note">{importStatus}</p> : null}
        {importError ? <p className="status-note status-note--error">{importError}</p> : null}
      </section>

      <section className="forecast-summary-panel">
        <p className="eyebrow">Что прочитано из файла</p>
        <h3>Проверка</h3>
        {source.routeLine ? (
          <dl className="forecast-summary-grid forecast-summary-grid--compact">
            <div>
              <dt>Длина маршрута</dt>
              <dd>{formatPz3Km(source.totalLengthKm)}</dd>
            </div>
            <div>
              <dt>Станций</dt>
              <dd>{source.stations.length}</dd>
            </div>
            <div>
              <dt>Точек линии</dt>
              <dd>{source.routeLine.vertices.length}</dd>
            </div>
            <div>
              <dt>Сегментов</dt>
              <dd>{describeSegments(getPz3SegmentMarks(source))}</dd>
            </div>
          </dl>
        ) : (
          <p className="status-note">Файл пока не загружен.</p>
        )}
      </section>
    </div>
  );
}

function Pz3TheoryStep() {
  return (
    <div className="theory-layout">
      <section>
        <p className="eyebrow">Календарно-сетевой график</p>
        <h2>Как работы определяют срок строительства</h2>
        <p>
          Сначала трассу разбивают на работы и пространственные этапы. Затем связи между работами показывают, что
          можно выполнять параллельно, а что должно ждать завершения предшественников. Расчёт начинается с дня 0.
        </p>
      </section>

      <div className="theory-grid theory-grid--four">
        <article>
          <span>01</span>
          <h3>Прямой проход</h3>
          <p>
            Работа без предшественников начинается в день 0. Для остальных раннее начало равно самому позднему
            раннему окончанию предшественников. Раннее окончание равно началу плюс длительность.
          </p>
        </article>
        <article>
          <span>02</span>
          <h3>Срок проекта</h3>
          <p>
            Минимальный срок задаёт самое позднее окончание завершающей работы. Ускорение короткой параллельной ветви
            не сокращает проект, пока более длинная ветвь всё ещё задерживает следующую работу.
          </p>
        </article>
        <article>
          <span>03</span>
          <h3>Критический путь</h3>
          <p>
            Обратный проход даёт поздние сроки. Полный резерв равен позднему началу минус раннее начало. Непрерывная
            цепочка работ с нулевым резервом образует критический путь; таких цепочек может быть несколько.
          </p>
        </article>
        <article>
          <span>04</span>
          <h3>Выравнивание ресурсов</h3>
          <p>
            Критические работы двигать нельзя. Некритические можно сдвигать внутри их резерва, уменьшая пик занятости
            людей без изменения общего срока проекта.
          </p>
        </article>
      </div>
    </div>
  );
}

/**
 * Отчёт по проекту (ТЗ ПЗ3 §9): материалы, человеко-часы, машино-часы.
 *
 * Считается по тем же нормативам, что и сроки на экране 04, поэтому цифры
 * отчёта и графика сходятся между собой. Статус нормативов хранится в данных,
 * но не выводится студенту как служебная оговорка на экране результата.
 */
function Pz3ReportSection() {
  const { draft, importedBridge } = useModuleState<Pz3Draft>();
  const source = getPz3RouteSource(importedBridge);
  const report = getPz3Report(draft);
  const plan = getPz3Plan(
    draft,
    draft.stages.map((stage) => ({
      stageId: stage.id,
      workers: Number(draft.workersByStage[stage.id]?.replace(/[^0-9]/g, '') || 0),
    })),
    Number(draft.totalWorkers.replace(/[^0-9]/g, '') || 0),
  );

  if (report.laborHours === 0) {
    return (
      <section className="form-section">
        <p className="eyebrow">Отчёт</p>
        <h3>Материалы, человеко-часы и машино-часы</h3>
        <p className="status-note">
          Отчёт считается по работам с длиной или количеством. Пока таких работ нет, считать нечего.
        </p>
      </section>
    );
  }

  return (
    <section className="form-section">
      <p className="eyebrow">Отчёт</p>
      <h3>Материалы, человеко-часы и машино-часы</h3>

      <dl className="forecast-summary-grid forecast-summary-grid--compact">
        <div>
          <dt>Трудоёмкость</dt>
          <dd>{formatAmount(report.laborHours)} чел.-ч</dd>
        </div>
        <div>
          <dt>Машино-часы</dt>
          <dd>{formatAmount(report.machineHours)} маш.-ч</dd>
        </div>
        <div>
          <dt>Срок по графику</dt>
          <dd>{plan.metrics.projectDuration > 0 ? `${plan.metrics.projectDuration} дн.` : 'не рассчитан'}</dd>
        </div>
        <div>
          <dt>Длина маршрута</dt>
          <dd>{formatPz3Km(source.totalLengthKm)}</dd>
        </div>
      </dl>

      <div className="report-columns">
        <ReportTable caption="Материалы" rows={report.materials} />
        <ReportTable caption="Машины" rows={report.machines} />
      </div>

    </section>
  );
}

function ReportTable({ caption, rows }: { caption: string; rows: ReturnType<typeof getPz3Report>['materials'] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="table-scroll">
      <table className="input-table">
        <caption className="eyebrow">{caption}</caption>
        <thead>
          <tr>
            {/* Единица стоит рядом с числом, а не отдельной колонкой: в узкой
                колонке отчёта третий столбец не помещался и заголовок
                обрезался на «ЕДИНИЦ». В PDF расход печатается так же. */}
            <th>Позиция</th>
            <th className="numeric">Расход</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.title}>
              <th scope="row">{row.title}</th>
              <td className="numeric">
                {formatAmount(row.amount)} {row.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function Pz3ResultStep() {
  const { draft, importedBridge } = useModuleState<Pz3Draft>();
  const [exportStatus, setExportStatus] = useState('');
  const source = getPz3RouteSource(importedBridge);
  const check = getPz3LengthCheck(draft, source.totalLengthKm);
  const inPool = getPz3StageWorks(draft, null).length;

  async function downloadPdf() {
    try {
      // Отчёт грузится по требованию: библиотека PDF весит больше самого
      // модуля, и тянуть её ради экрана, до которого дошли не все, незачем.
      const { downloadPz3Pdf } = await import('../../pdf/pz3Report');
      const bridge = createPz3Bridge(draft, importedBridge);

      await downloadPz3Pdf(
        {
          team: bridge.passport.team,
          lineTitle: bridge.passport.lineTitle,
          createdAt: bridge.passport.createdAt,
          runId: bridge.passport.runId,
          routeLengthKm: source.totalLengthKm,
          previewImage: draft.previewImage,
          result: bridge.completed.pz3!,
          workKindLabels: Object.fromEntries(pz3WorkKinds.map((kind) => [kind.id, kind.label])),
          conditionLabels: Object.fromEntries(
            bridge.completed.pz3!.works.flatMap((work) => work.conditions.map((id) => [id, getPz3OptionLabel(id, work.kind)])),
          ),
        },
        'vsm-pz3-report.pdf',
      );
      setExportStatus('✓ Файл сохранён');
    } catch {
      setExportStatus('Не удалось сформировать PDF. Сохраните JSON и повторите экспорт.');
    }
  }

  function downloadJson() {
    jsonFileDraftStorage.save(createPz3Bridge(draft, importedBridge), 'vsm-pz3-bridge.json');
    setExportStatus('✓ Файл сохранён');
  }

  return (
    <div className="result-layout">
      <div className="result-layout__aside">
        <section className="form-section">
          <p className="eyebrow">Итог</p>
          <h2>Работ по трассе: {draft.works.length}</h2>

          <dl className="forecast-summary-grid forecast-summary-grid--compact">
            <div>
              <dt>Намерено</dt>
              <dd>{formatPz3Km(check.measuredKm)}</dd>
            </div>
            <div>
              <dt>Маршрут из ПЗ1</dt>
              <dd>{formatPz3Km(check.routeKm)}</dd>
            </div>
            <div>
              <dt>Этапов</dt>
              <dd>{draft.stages.length}</dd>
            </div>
          </dl>

          {draft.stages.length > 0 ? (
            <ul className="stage-list">
              {draft.stages.map((stage) => {
                const works = getPz3StageWorks(draft, stage.id);

                return (
                  <li className="stage-card" key={stage.id}>
                    <div className="stage-card__head">
                      <h4>{stage.title}</h4>
                      <span className="stage-card__meta">Работ: {works.length}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {inPool > 0 ? <p className="field-warning">В пуле осталось работ: {inPool}</p> : null}
        </section>

        <section className="result-actions">
          <p className="eyebrow">Экспорт</p>
          <h2>Скачать файлы</h2>
          <p className="status-note">
            PDF нужен для сдачи преподавателю. JSON — чтобы продолжить работу с теми же данными или передать её в следующее
            задание.
          </p>
          <button className="button button--primary" onClick={() => void downloadPdf()} type="button">
            Скачать PDF
          </button>
          <button className="button button--outline" onClick={downloadJson} type="button">
            Скачать JSON
          </button>
          {exportStatus ? <p className="status-note">{exportStatus}</p> : null}
        </section>
      </div>

      <Pz3ReportSection />
    </div>
  );
}
