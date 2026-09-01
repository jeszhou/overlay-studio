import { Component, type ErrorInfo, type ReactNode } from "react";
import "./CrashGate.css";

/**
 * 崩溃兜底:任何渲染错误都在这里被接住,页面不再整片黑。
 *
 * 起因是 2026-08-31 一位客户导入 JSON 后整页黑屏 —— 崩了但一个字都不说,
 * 他只能去卸载重装浏览器(最后确认是他那个 Chrome 的问题,不是代码)。
 * 排查成本全花在「什么线索都没有」上,所以这里至少要留一句人话 + 一个自救按钮。
 */
interface State {
  err: Error | null;
}

export class CrashGate extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[Overlay Studio] 渲染崩溃:", err, info.componentStack);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;

    return (
      <div className="crash-gate">
        <h1>编辑台出错了</h1>
        <p>
          页面渲染中断。<b>大多数情况不是编排文件的问题,而是浏览器环境</b> ——
          先试试关掉浏览器翻译和插件,或者换一个浏览器打开。
        </p>
        <pre>{err.message}</pre>
        <div className="crash-gate-btns">
          <button onClick={() => location.reload()}>刷新重试</button>
          <button
            className="ghost"
            onClick={() => {
              // 存档可能是坏的:清掉再刷新。用户的 JSON 文件在本地,重新导入即可。
              if (!confirm("清空自动存档并刷新?\n\n(你的 JSON 和视频文件不受影响,刷新后重新导入一次即可)")) return;
              try {
                localStorage.clear();
              } catch {
                /* 隐私模式下会抛,忽略 */
              }
              location.reload();
            }}
          >
            清空存档后刷新
          </button>
        </div>
        <p className="crash-gate-hint">
          还是不行的话,按 F12 打开控制台,把红色报错截图发给作者。
        </p>
      </div>
    );
  }
}
