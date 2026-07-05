/**
 * 小白台词模板库(mock 渲染)。占位符见 types.ts LineTemplates 注释。
 * 铁律:模板中不得出现任何知识点专业术语——术语只能经 {term}/{belief}/{probe} 槽位进入。
 */
import type { LineTemplates } from '../types';

export const XIAOBAI_LINES: LineTemplates = {
  好奇型: {
    ask_clarify: [
      '老师,{term}到底是什么意思呀?我有点跟不上了。',
      '等等等等,{probe}',
      '哇,听起来好厉害,但是……{probe}',
    ],
    ask_example: [
      '嗯……道理我好像听懂一点了,能举个生活里的例子吗?',
      '老师能不能拿个具体的例子给我比划比划?我光听概念有点晕。',
    ],
    ask_boundary: ['{probe}', '我突然想到一个情况——{probe}'],
    inject_misconception: ['{belief}'],
    ask_transfer: ['老师我好像悟了!那{transfer}是不是也一样?',
      '哦哦哦,那我猜猜——{transfer}也是这个道理吧?'],
    express_understanding: [
      '哦——!我懂了!所以说{paraphrase},对吧?',
      '原来是这样!{paraphrase}……嘿嘿,我记住了!',
    ],
    rescue_hint: [
      '老师,是不是跟你刚才说的{term}有关系呀?你顺着那个讲讲?',
      '嗯……要不从你刚才讲的{term}那里接着说?我觉得快通了。',
    ],
    propose_lookup: [
      '老师别急,要不……我们一起查查书?查到了你再讲给我听,我肯定认真听!',
    ],
    stay_confused: [
      '可是……我还是觉得{belief},你能证明给我看吗?',
      '呃,老师,这个跟今天的知识点没关系吧?我还想听你讲刚才那个呢。',
    ],
    trigger_review: [
      '老师……上次那个我好像有点忘了,你再给我讲讲呗?',
    ],
  },
  严谨型: {
    ask_clarify: ['等等,这里我想确认一个细节:{probe}', '老师,{term}的准确含义是什么?我想先把定义弄清楚。'],
    ask_example: ['能给一个具体的例子吗?我需要一个能验证的案例。'],
    ask_boundary: ['我想确认一种边界情况:{probe}'],
    inject_misconception: ['{belief}'],
    ask_transfer: ['按这个逻辑推下去,{transfer}应该也成立,对吗?'],
    express_understanding: ['明白了。也就是说{paraphrase}——这样表述准确吗?'],
    rescue_hint: ['是否可以从你刚才提到的{term}继续?那部分你讲得很清楚。'],
    propose_lookup: ['要不我们查一下资料再继续?我想要一个可靠的依据。'],
    stay_confused: ['抱歉,我仍然认为{belief}。请给出能说服我的论证。'],
    trigger_review: ['老师,上次那个知识点,有个细节我记不清了,能再讲一次吗?'],
  },
  杠精型: {
    ask_clarify: ['且慢,{probe}你先把这个说圆了。', '{term}?你确定你没说错?展开讲讲。'],
    ask_example: ['空口无凭,举个例子来听听?'],
    ask_boundary: ['哼,那我抬个杠——{probe}'],
    inject_misconception: ['{belief}'],
    ask_transfer: ['行,就算你说得对,那{transfer}呢?一样吗?'],
    express_understanding: ['……好吧,这次算你讲明白了。{paraphrase},我认了。'],
    rescue_hint: ['卡住啦?你刚才{term}不是讲得挺溜的吗,接着编啊。'],
    propose_lookup: ['讲不下去了吧?行了行了,一起查书,查完你再给我讲。'],
    stay_confused: ['我不信。{belief}——你倒是证明给我看啊。'],
    trigger_review: ['喂老师,上次那个东西我忘了,你不会也忘了吧?再讲一遍。'],
  },
};
