/**
 * 在 Pyodide 里执行的 Python 运行器：负责工作目录、输出流、图表收集、文件差异和报错整理。
 * 它运行在自己的命名空间里，用户代码用的是另一份全局变量（_namespace），互不踩踏。
 * 注意：这是 String.raw 模板，Python 源码里不要出现反引号和「美元符号 + 花括号」。
 */
export const PY_HARNESS = String.raw`
import base64, builtins, io, json, linecache, os, site, sys, traceback, warnings, zlib
from pyodide.code import eval_code_async, find_imports

WORK = '/work'
RUN_PREFIX = '<run-'
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 8 * 1024 * 1024
MAX_FILES = 40
MAX_FIGURES = 12
MAX_REPR = 20000
MAX_TRACEBACK = 3600
FIGURE_DPI = 144
FIGURE_MAX_PIXELS = 2400
# 常见中文绘图代码会点名这些字体；都指到随站的那一份上，免得满屏方框
CJK_ALIASES = (
    'SimHei', 'SimSun', 'Microsoft YaHei', 'PingFang SC', 'Heiti SC', 'Heiti TC', 'STHeiti',
    'Songti SC', 'KaiTi', 'FangSong', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC',
    'Source Han Sans CN', 'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', 'Arial Unicode MS',
)

_namespace = {'__name__': '__main__', '__builtins__': builtins}
_state = {'runs': 0, 'packages': [], 'imports': set(), 'font': None, 'pyplot': None}
_figures = []
_notes = []
_site_packages = [path.rstrip('/') + '/' for path in site.getsitepackages()]

os.makedirs(WORK, exist_ok=True)
os.chdir(WORK)
if WORK not in sys.path:
    sys.path.insert(0, WORK)


def _no_input(*_args, **_kwargs):
    raise RuntimeError('这个运行环境读不到键盘输入，请把参数直接写进代码。')


builtins.input = _no_input


class _Stream(io.TextIOBase):
    """把 print 的内容直接交给 JS，边运行边显示"""

    encoding = 'utf-8'

    def __init__(self, sink):
        super().__init__()
        self._sink = sink

    def writable(self):
        return True

    def write(self, text):
        if text:
            self._sink(text)
        return len(text)


def configure(settings):
    settings = json.loads(settings)
    _state['packages'] = settings['packages']
    _state['imports'] = set(settings['imports'])
    _state['font'] = settings.get('font')


def setup_matplotlib():
    """固定 Agg 后端、接上中文字体，并把 plt.show() 换成“收图”。只做一次。"""
    if _state['pyplot'] is not None:
        return _state['pyplot']
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib import font_manager

    warnings.filterwarnings('ignore', message='.*non-interactive.*')
    font = _state['font']
    if font and os.path.exists(font):
        try:
            manager = font_manager.fontManager
            manager.addfont(font)
            family = manager.ttflist[-1].name
            for alias in CJK_ALIASES:
                manager.ttflist.append(font_manager.FontEntry(
                    fname=font, name=alias, style='normal', variant='normal',
                    weight=400, stretch='normal', size='scalable'))
            # 默认字体没有汉字：照常用原字体，缺字时落到中文字体；末尾再垫一层原字体补负号等符号
            chain = ['sans-serif', family, 'DejaVu Sans']
            matplotlib.rcParams['font.family'] = chain
            matplotlib.rcParamsDefault['font.family'] = chain
        except Exception as error:
            _notes.append('中文字体没有加载成功，图里的中文可能显示成方框：' + repr(error))

    def show(*_args, **_kwargs):
        _grab_figures()

    plt.show = show
    _state['pyplot'] = plt
    return plt


def _has_content(figure):
    return bool(figure.get_axes() or figure.texts or figure.images or figure.lines
                or figure.patches or figure.artists or figure.legends)


def _grab_figures():
    """把当前打开的图存成 PNG 并关掉；plt.show() 和每次运行结束都会走到这里"""
    plt = sys.modules.get('matplotlib.pyplot')
    if plt is None:
        return
    dropped = 0
    for number in plt.get_fignums():
        figure = plt.figure(number)
        if not _has_content(figure):
            continue
        if len(_figures) >= MAX_FIGURES:
            dropped += 1
            continue
        width, height = figure.get_size_inches()
        dpi = max(50, min(FIGURE_DPI, FIGURE_MAX_PIXELS / max(width, height, 1)))
        buffer = io.BytesIO()
        try:
            figure.savefig(buffer, format='png', dpi=dpi, bbox_inches='tight')
        except Exception:
            buffer = io.BytesIO()
            try:
                figure.savefig(buffer, format='png', dpi=dpi)
            except Exception as error:
                _notes.append('有一张图没能导出：' + repr(error))
                continue
        _figures.append('data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii'))
    plt.close('all')
    if dropped:
        _notes.append('图太多，只保留了前 ' + str(MAX_FIGURES) + ' 张，另有 ' + str(dropped) + ' 张没有回传。')


def _snapshot():
    """工作目录里每个文件的指纹，用来找出这次运行新建或改过的文件"""
    seen = {}
    for root, folders, names in os.walk(WORK):
        folders[:] = [folder for folder in folders if folder != '__pycache__']
        for name in names:
            path = os.path.join(root, name)
            try:
                info = os.stat(path)
                if info.st_size <= MAX_FILE_BYTES:
                    with open(path, 'rb') as handle:
                        mark = zlib.crc32(handle.read())
                else:
                    mark = info.st_mtime_ns
                seen[path] = (info.st_size, mark)
            except OSError:
                pass
    return seen


def _megabytes(size):
    return format(size / 1048576, '.1f') + ' MB'


def _changed_files(before):
    files = []
    total = 0
    after = _snapshot()
    for path in sorted(after):
        if before.get(path) == after[path]:
            continue
        relative = os.path.relpath(path, WORK)
        size = after[path][0]
        if size > MAX_FILE_BYTES:
            _notes.append('文件 ' + relative + ' 有 ' + _megabytes(size) + '，超过 2 MB，没有回传。')
            continue
        if len(files) >= MAX_FILES or total + size > MAX_TOTAL_BYTES:
            _notes.append('文件 ' + relative + ' 没有回传：这次产生的文件太多或总量太大。')
            continue
        try:
            with open(path, 'rb') as handle:
                data = handle.read()
        except OSError:
            continue
        total += len(data)
        try:
            if b'\x00' in data:
                raise ValueError('binary')
            files.append({'path': relative, 'content': data.decode('utf-8'), 'encoding': 'utf8'})
        except ValueError:
            files.append({'path': relative, 'content': base64.b64encode(data).decode('ascii'), 'encoding': 'base64'})
    return files


def _is_plot_handle(value):
    if (type(value).__module__ or '').startswith('matplotlib'):
        return True
    return isinstance(value, (list, tuple)) and bool(value) and all(_is_plot_handle(item) for item in value[:8])


def _safe_repr(value):
    # plt.plot(...) 这类调用的返回值只是一串对象地址，不当作结果
    if _is_plot_handle(value):
        return None
    try:
        text = repr(value)
    except Exception as error:
        return '<结果无法显示：' + repr(error) + '>'
    if len(text) > MAX_REPR:
        text = text[:MAX_REPR] + '\n…（结果过长，已截断）'
    return text


def _missing_module_hint(error):
    if not isinstance(error, ModuleNotFoundError) or not error.name:
        return ''
    top = error.name.split('.')[0]
    if top in _state['imports']:
        return ''
    available = '、'.join(_state['packages'])
    if top in sys.stdlib_module_names:
        return '浏览器里的 Python 不带标准库模块 ' + top + '。可用的三方包：' + available + '。'
    return ('运行环境里没有 ' + top + '，这里也不能联网安装。可用的三方包只有：'
            + available + '，其余请用 Python 标准库实现。')


def _describe_error(error):
    """回溯只留用户代码的帧和最靠近出错点的两层库代码"""
    frames = traceback.extract_tb(error.__traceback__)
    first = next((i for i, frame in enumerate(frames) if frame.filename.startswith(RUN_PREFIX)), None)
    frames = frames[first:] if first is not None else []
    lines = []
    if frames:
        lines.append('Traceback (most recent call last):\n')
        skipped = 0
        for index, frame in enumerate(frames):
            if frame.filename.startswith(RUN_PREFIX) or index >= len(frames) - 2:
                if skipped:
                    lines.append('  …省略库内部 ' + str(skipped) + ' 层调用…\n')
                    skipped = 0
                lines.extend(traceback.format_list([frame]))
            else:
                skipped += 1
    lines.extend(traceback.format_exception_only(type(error), error))
    text = ''.join(lines).rstrip()
    for prefix in _site_packages:
        text = text.replace(prefix, '')
    if len(text) > MAX_TRACEBACK:
        text = text[:1200] + '\n…（中间已省略）…\n' + text[-2200:]
    hint = _missing_module_hint(error)
    return text + '\n\n' + hint if hint else text


async def run(code, write_out, write_err):
    _state['runs'] += 1
    filename = RUN_PREFIX + str(_state['runs']) + '>'
    del _figures[:]
    del _notes[:]
    outcome = {'ok': True, 'result': None, 'error': None}
    os.makedirs(WORK, exist_ok=True)
    os.chdir(WORK)
    before = _snapshot()
    # 登记源码，回溯里才能显示出错的那一行
    linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
    saved = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = _Stream(write_out), _Stream(write_err)
    try:
        try:
            if any(name.split('.')[0] in ('matplotlib', 'pylab', 'mpl_toolkits') for name in find_imports(code)):
                setup_matplotlib()
            value = await eval_code_async(code, globals=_namespace, filename=filename)
            if value is not None:
                outcome['result'] = _safe_repr(value)
        except SystemExit as request:
            if request.code not in (None, 0):
                outcome.update(ok=False, error='程序以状态码 ' + str(request.code) + ' 退出')
        except BaseException as error:
            outcome.update(ok=False, error=_describe_error(error))
        try:
            _grab_figures()
        except Exception as error:
            _notes.append('收集图表时出错：' + repr(error))
    finally:
        sys.stdout, sys.stderr = saved
    try:
        os.chdir(WORK)
    except OSError:
        pass
    outcome['files'] = _changed_files(before)
    outcome['figures'] = list(_figures)
    outcome['notes'] = list(_notes)
    del _figures[:]
    return json.dumps(outcome, ensure_ascii=False)
`;
