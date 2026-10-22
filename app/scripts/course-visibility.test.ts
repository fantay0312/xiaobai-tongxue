import assert from 'node:assert/strict';
import { isValidationCourse, partitionCourseGroups } from '../src/lib/courseVisibility';

for (const title of [
  '上传提速验收-财务管理-1013', '大PDF验收-财务管理-1013', '线上验收-栈与函数调用-1013-2140',
  '测试课程', '验收项目-1014', '【测试】财务管理', '［QA］课程', 'E2E-course',
  'Test project upload', 'SMOKE-1022', '财务管理（验收）', '财务管理-测试-20261022',
]) assert.equal(isValidationCourse(title), true, title);

for (const title of [
  '软件测试', '测试驱动开发', '软件质量与验收', '用户验收测试', '大模型训练',
  'Python 程序设计', '操作系统原理', '审计学', '统计假设测试', 'Test Driven Development',
  'Testing software', 'Quality Assurance', '接口测试基础', '性能测试方法',
]) assert.equal(isValidationCourse(title), false, title);

const original: Array<[string, { title: string; items: string[] }]> = [
  ['one', { title: '软件测试', items: ['regular'] }],
  ['two', { title: '线上验收-1013', items: ['validation'] }],
  ['three', { title: '操作系统原理', items: [] }],
];
const snapshot = JSON.stringify(original);
const result = partitionCourseGroups(original);
assert.deepEqual(result.regular.map(([key]) => key), ['one', 'three']);
assert.deepEqual(result.validation.map(([key]) => key), ['two']);
assert.equal(JSON.stringify(original), snapshot, 'partition does not alter course data or order');
assert.equal(result.validation[0], original[1], 'course identities and contents remain intact');
assert.deepEqual(partitionCourseGroups([]), { regular: [], validation: [] });
console.log('Course classification, genuine testing subjects, stable ordering and data preservation: passed.');
