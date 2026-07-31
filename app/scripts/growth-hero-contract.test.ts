import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { STAGE_META, getStageMeta } from '../src/engine/evolution';

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

const sourcePath = fileURLToPath(new URL('../src/pages/growth/index.tsx', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const growthStylePath = fileURLToPath(new URL('../src/pages/growth/growth.module.css', import.meta.url));
const seaStylePath = fileURLToPath(new URL('../src/pages/growth/KnowledgeSeaField.module.css', import.meta.url));
const seaFieldPath = fileURLToPath(new URL('../src/pages/growth/KnowledgeSeaField.tsx', import.meta.url));
const seaGeometryPath = fileURLToPath(new URL('../src/pages/growth/knowledgeSeaGeometry.ts', import.meta.url));
const growthStyle = readFileSync(growthStylePath, 'utf8');
const seaStyle = readFileSync(seaStylePath, 'utf8');
const seaFieldSource = readFileSync(seaFieldPath, 'utf8');
const seaGeometrySource = readFileSync(seaGeometryPath, 'utf8');
const sourceFile = ts.createSourceFile(
  sourcePath,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const openingOf = (node: JsxNode): ts.JsxOpeningLikeElement =>
  ts.isJsxElement(node) ? node.openingElement : node;

const tagOf = (node: JsxNode): string => openingOf(node).tagName.getText(sourceFile);

const attributeOf = (node: JsxNode, name: string): ts.JsxAttribute | undefined =>
  openingOf(node).attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === name,
  );

const attributeValue = (node: JsxNode, name: string): string | null => {
  const initializer = attributeOf(node, name)?.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (ts.isJsxExpression(initializer)) {
    const expression = initializer.expression;
    return expression && ts.isStringLiteral(expression) ? expression.text : null;
  }
  return null;
};

const jsxNodesWithin = (root: ts.Node): JsxNode[] => {
  const nodes: JsxNode[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return nodes;
};

const directJsxChildren = (node: ts.JsxElement): JsxNode[] =>
  node.children.filter(
    (child): child is JsxNode => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
  );

const cssRuleEntries = (css: string): Array<{ selectors: string; body: string }> =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selectors: match[1], body: match[2] }));

const classRules = (css: string, className: string): string[] => {
  const rules = cssRuleEntries(css)
    .filter(({ selectors }) => selectors.split(',').some((selector) => selector.trim() === `.${className}`))
    .map(({ body }) => body);
  assert.ok(rules.length > 0, `缺少 .${className} 样式规则`);
  return rules;
};

const classRule = (css: string, className: string): string => {
  return classRules(css, className).join('\n');
};

const numericProperty = (rule: string, property: string): number => {
  const match = rule.match(new RegExp(`${property}:\\s*([0-9.]+)`));
  assert.ok(match, `${property} 必须使用可校验的数值`);
  return Number(match[1]);
};

const allJsx = jsxNodesWithin(sourceFile);
const hero = allJsx.find(
  (node): node is ts.JsxElement =>
    ts.isJsxElement(node)
    && tagOf(node) === 'header'
    && attributeValue(node, 'aria-labelledby') === 'growth-title',
);
assert.ok(hero, '成长册卷首必须由 aria-labelledby="growth-title" 的 header 统领');

const semanticColumns = directJsxChildren(hero).filter((node) =>
  tagOf(node) === 'section' || tagOf(node) === 'aside');
assert.equal(semanticColumns.length, 3, '卷首必须保留左、中、右三个直接语义容器');
assert.deepEqual(
  semanticColumns.map((node) => [tagOf(node), attributeValue(node, 'aria-labelledby'), attributeValue(node, 'aria-label')]),
  [
    ['section', 'growth-title', null],
    ['section', null, '小白的五阶成长进度'],
    ['aside', null, '成长侧注'],
  ],
  '三栏阅读顺序必须是题头、成长进度、成长侧注',
);
assert.ok(
  jsxNodesWithin(semanticColumns[0]).some(
    (node) => tagOf(node) === 'h1' && attributeValue(node, 'id') === 'growth-title',
  ),
  '题头栏必须包含可被卷首引用的 growth-title',
);
const profileNodes = jsxNodesWithin(semanticColumns[0]);
const headingNode = profileNodes.find((node) => tagOf(node) === 'h1');
const portraitNode = profileNodes.find((node) => tagOf(node) === 'figure');
assert.ok(headingNode && portraitNode && headingNode.pos < portraitNode.pos, '读屏顺序必须先题头、后装饰画像');

const progressbar = allJsx.find(
  (node) => attributeValue(node, 'role') === 'progressbar',
);
assert.ok(progressbar, '学识进度必须保留 progressbar 语义');
for (const name of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-label', 'aria-valuetext']) {
  assert.ok(attributeOf(progressbar, name), `progressbar 缺少 ${name}`);
}

const currentStageItem = allJsx.find(
  (node) => tagOf(node) === 'li' && attributeOf(node, 'aria-current') !== undefined,
);
assert.ok(currentStageItem, '五阶成长轴必须用 aria-current 标出当前阶段');
assert.match(
  attributeOf(currentStageItem, 'aria-current')?.getText(sourceFile) ?? '',
  /['"]step['"]/,
  'aria-current 必须使用 step 语义',
);

const personaButton = allJsx.find(
  (node) =>
    tagOf(node) === 'button'
    && attributeOf(node, 'aria-pressed') !== undefined
    && /setPersona\s*\(/.test(attributeOf(node, 'onClick')?.getText(sourceFile) ?? ''),
);
assert.ok(personaButton, '性情按钮必须同时保留 aria-pressed 状态与 setPersona 交互');

assert.deepEqual(STAGE_META.map(({ stage }) => stage), [1, 2, 3, 4, 5], '科名必须保持五阶');
assert.equal(new Set(STAGE_META.map(({ name }) => name)).size, 5, '五阶科名名称必须唯一');
for (const meta of STAGE_META) {
  assert.ok(meta.name && meta.description, `第 ${meta.stage} 阶元数据不完整`);
  assert.deepEqual(getStageMeta(meta.stage), meta, `第 ${meta.stage} 阶必须由集中元数据派生`);
}
assert.match(source, /STAGE_META\.map\s*\(/, '成长轴阶段必须从 STAGE_META 派生');
assert.match(
  source,
  /getStageMeta\s*\(\s*global\.learningLevel\s*\)/,
  '当前科名必须从 learningLevel 与集中元数据派生',
);

const dreamGoal = sourceFile.statements.find(
  (statement): statement is ts.VariableStatement =>
    ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(
      (declaration) => declaration.name.getText(sourceFile) === 'DREAM_GOAL',
    ),
);
const dreamDeclaration = dreamGoal?.declarationList.declarations.find(
  (declaration) => declaration.name.getText(sourceFile) === 'DREAM_GOAL',
);
assert.equal(dreamDeclaration?.initializer?.getText(sourceFile), '5', '第一次试讲应由五门出师解锁');

const hasDreamUnlock = (() => {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && /global\.topicsMastered\s*>=\s*DREAM_GOAL/.test(node.left.getText(sourceFile))
      && jsxNodesWithin(node.right).some(
        (jsx) => (tagOf(jsx) === 'section' || tagOf(jsx) === 'article') && attributeOf(jsx, 'aria-label') !== undefined,
      )
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
})();
assert.ok(hasDreamUnlock, 'DREAM_GOAL 达成后必须解锁一个有可访问名称的试讲场景');

const chronicleSection = allJsx.find(
  (node): node is ts.JsxElement =>
    ts.isJsxElement(node)
    && tagOf(node) === 'section'
    && attributeValue(node, 'id') === 'chronicle',
);
assert.ok(chronicleSection, '教学编年史必须保留 #chronicle 锚点');
assert.equal(
  attributeValue(chronicleSection, 'aria-labelledby'),
  'chronicle-title',
  '教学编年史必须由独立标题命名',
);
const chronicleNodes = jsxNodesWithin(chronicleSection);
assert.ok(
  chronicleNodes.some((node) => tagOf(node) === 'dl' && /ledgerMeta/.test(attributeOf(node, 'className')?.getText(sourceFile) ?? '')),
  '编年史摘要必须使用描述列表语义',
);
assert.ok(
  chronicleNodes.some((node) => tagOf(node) === 'time' && attributeOf(node, 'dateTime') !== undefined),
  '编年史日期必须使用 time/dateTime 语义',
);
assert.ok(chronicleNodes.some((node) => tagOf(node) === 'article'), '每条课堂记录必须是独立 article');
assert.ok(chronicleNodes.some((node) => tagOf(node) === 'h3'), '课堂主题必须使用层级标题');

const gallerySection = allJsx.find(
  (node): node is ts.JsxElement =>
    ts.isJsxElement(node)
    && tagOf(node) === 'section'
    && attributeValue(node, 'aria-labelledby') === 'gallery-title',
);
assert.ok(gallerySection, '金句画廊必须由独立标题命名');
const galleryNodes = jsxNodesWithin(gallerySection);
const galleryList = galleryNodes.find(
  (node) => tagOf(node) === 'ol' && /galleryList/.test(attributeOf(node, 'className')?.getText(sourceFile) ?? ''),
);
assert.ok(galleryList, '金句画廊必须使用有序馆藏列表,不得退回无语义横向卡流');
for (const tagName of ['figure', 'blockquote', 'cite', 'time']) {
  assert.ok(galleryNodes.some((node) => tagOf(node) === tagName), `金句画廊缺少 ${tagName} 语义`);
}
assert.doesNotMatch(source, /galleryFlow|galleryCard/, '金句画廊不得回退为 AI 感横向卡流');

const logItemRule = classRule(growthStyle, 'logItem');
assert.doesNotMatch(logItemRule, /background:|border-radius:/, '编年史条目必须去卡片化');
assert.ok(
  numericProperty(classRule(growthStyle, 'logLink'), 'min-height') >= 2.75,
  '复盘链接热区必须至少 44px',
);
assert.ok(
  numericProperty(classRule(growthStyle, 'pageTurn'), 'min-height') >= 2.75,
  '翻旧页按钮热区必须至少 44px',
);
const galleryListRules = classRules(growthStyle, 'galleryList');
assert.ok(galleryListRules.length >= 2, '金句画廊的基础与响应式规则必须一并纳入契约检查');
assert.doesNotMatch(
  galleryListRules.join('\n'),
  /overflow-x|mask-image/,
  '金句画廊必须自然排版,不使用隐性横滚',
);

const linkRule = classRule(seaStyle, 'link');
assert.ok(numericProperty(linkRule, 'stroke-width') <= 0.8, '语义星链前景线宽不得超过 0.8px');
assert.match(linkRule, /stroke-dasharray:\s*none/, '语义星链必须是连续实线');
assert.ok(
  numericProperty(classRule(seaStyle, 'linkGlow'), 'stroke-width') <= 2.5,
  '星链辉光宽度不得超过 2.5px',
);
assert.match(classRule(seaStyle, 'linkLayer'), /pointer-events:\s*none/, '星链层不得拦截星宿交互');
const nodeRule = classRule(seaStyle, 'node');
assert.match(nodeRule, /width:\s*44px/, '星宿按钮宽度必须保持 44px');
assert.match(nodeRule, /height:\s*44px/, '星宿按钮高度必须保持 44px');
assert.match(classRule(growthStyle, 'evidenceOrbit'), /border:\s*0\.75px\s+solid/, '星海证据空态轨道也必须是细实线');
assert.match(seaFieldSource, /<svg[\s\S]*?aria-hidden="true"/, '语义星链 SVG 必须对读屏隐藏');
assert.match(seaGeometrySource, /\.slice\(0,\s*3\)/, '单颗星一次最多显示 3 条语义链');

console.log('growth hero contract: all assertions passed');
