import type { ModulePhase } from '../../bridge/context';

interface ProgressStop {
  phase: ModulePhase;
  label: string;
}

const STOPS: ProgressStop[] = [
  { phase: 'intro', label: 'Подготовка' },
  { phase: 'task', label: 'Выполнение' },
  { phase: 'result', label: 'Результат' },
];

interface ProgressRouteProps {
  activePhase: ModulePhase;
}

export function ProgressRoute({ activePhase }: ProgressRouteProps) {
  const activeIndex = STOPS.findIndex((stop) => stop.phase === activePhase);

  return (
    <nav className="progress-route" aria-label="Этапы работы">
      <ol>
        {STOPS.map((stop, index) => {
          const stateClass = index < activeIndex ? 'is-complete' : index === activeIndex ? 'is-current' : '';

          return (
            <li aria-current={index === activeIndex ? 'step' : undefined} className={stateClass} key={stop.phase}>
              <span aria-hidden="true">{index < activeIndex ? '✓' : String(index + 1).padStart(2, '0')}</span>
              <b>{stop.label}</b>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
