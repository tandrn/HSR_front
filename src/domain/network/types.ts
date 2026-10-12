export type CalculationMode = 'fixed-labor' | 'manual-duration';

export type WorkItem = {
  id: string;
  code: string;
  title: string;
  from: string;
  to: string;
  duration: number;
  labor: number;
  workers: number;
  /** Ожидание без трудозатрат: влияет на срок, но не занимает рабочих. */
  isWaiting?: boolean;
  dependencies: string[];
  plannedShift?: number;
  isCritical?: boolean;
  earlyStart?: number;
  earlyFinish?: number;
  lateStart?: number;
  lateFinish?: number;
  totalFloat?: number;
  freeFloat?: number;
};

export type ScheduledWorkItem = Required<
  Pick<
    WorkItem,
    | 'isCritical'
    | 'earlyStart'
    | 'earlyFinish'
    | 'lateStart'
    | 'lateFinish'
    | 'totalFloat'
    | 'freeFloat'
  >
> &
  WorkItem;

export type ProjectScenario = {
  id: string;
  title: string;
  description: string;
  resourceLimit: number;
  works: WorkItem[];
};

export type WorkDefinition = {
  id: string;
  code: string;
  from: string;
  to: string;
  title: string;
  labor: number;
  workers: number;
  duration: number;
  calculationMode: CalculationMode;
  plannedShift?: number;
};

export type ResourceUsagePoint = {
  day: number;
  workers: number;
  overloaded: boolean;
  idle: boolean;
};

export type ProjectMetrics = {
  projectDuration: number;
  maxWorkers: number;
  averageWorkers: number;
  criticalCount: number;
  floatCount: number;
  overloadDays: number;
  idleDays: number;
  efficiency: number;
};

export type NetworkValidationError = {
  field?: keyof WorkDefinition | 'project';
  workId?: string;
  type:
    | 'missing-dependency'
    | 'cycle'
    | 'invalid-workers'
    | 'invalid-duration'
    | 'invalid-labor'
    | 'empty-project'
    | 'empty-code'
    | 'empty-title'
    | 'empty-from'
    | 'empty-to'
    | 'same-event'
    | 'invalid-number';
  message: string;
};

export type ScheduleResult = {
  items: ScheduledWorkItem[];
  projectDuration: number;
  errors: NetworkValidationError[];
};
