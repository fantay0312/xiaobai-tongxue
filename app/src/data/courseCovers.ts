import largeModelTraining from '../assets/course-covers/large-model-training.webp';
import operatingSystems from '../assets/course-covers/operating-systems.webp';
import pythonProgramming from '../assets/course-covers/python-programming.webp';

export interface CourseCover {
  src: string;
  mark: string;
  eyebrow: string;
  blurb: string;
}

/** 课程级题画：不改冻结的 Topic 契约，也不把同一张图重复塞进每个知识点。 */
export const COURSE_COVERS: Readonly<Record<string, CourseCover>> = {
  大模型训练: {
    src: largeModelTraining,
    mark: '织',
    eyebrow: '词元成线 · 反馈成织',
    blurb: '把离散词元、梯度与反馈，织成一条会推理的长线。',
  },
  操作系统原理: {
    src: operatingSystems,
    mark: '层',
    eyebrow: '层层有司 · 彼此相接',
    blurb: '从应用门前走到硬件地基，看清每一层怎样各司其职。',
  },
  'Python 程序设计': {
    src: pythonProgramming,
    mark: '引',
    eyebrow: '一线贯物 · 万象可编',
    blurb: '沿着对象与引用的线头，认清复制、嵌套与迭代。',
  },
};
