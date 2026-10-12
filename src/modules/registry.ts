import { lazy } from 'react';
import type { ModuleDefinition, PzNumber } from './types';

/**
 * Модули подгружаются по требованию.
 *
 * Каждое задание встраивается в iSpring отдельным Web Object по своему адресу
 * `?pz=N`, и студент за раз открывает ровно одно. Раньше сборка была общей:
 * на ПЗ3 грузился код ПЗ1 вместе с библиотекой диаграмм, которая нужна только
 * ему, и наоборот. Теперь на страницу приезжает только её модуль.
 */
export const moduleRegistry: Partial<Record<PzNumber, ModuleDefinition>> = {
  1: {
    id: 1,
    title: 'ПЗ1. Технико-экономическое обоснование',
    shortTitle: 'ПЗ1',
    Component: lazy(() => import('./pz1').then((module) => ({ default: module.Pz1Module }))),
  },
  3: {
    id: 3,
    title: 'ПЗ3. Календарно-сетевой график',
    shortTitle: 'ПЗ3',
    Component: lazy(() => import('./pz3').then((module) => ({ default: module.Pz3Module }))),
  },
};
