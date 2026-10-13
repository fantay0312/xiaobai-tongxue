import { Component, type PropsWithChildren } from 'react';

/** Module fetch failures must not leave the app shell permanently blank. */
export class ModuleRecovery extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  private onModuleError = () => {
    this.setState({ failed: true });
  };
  componentDidMount() { window.addEventListener('xiaobai:module-load-error', this.onModuleError); }
  componentWillUnmount() { window.removeEventListener('xiaobai:module-load-error', this.onModuleError); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="route-loader" role="alert">
      <p>页面加载中断，请重新加载后继续。</p>
      <button type="button" onClick={() => window.location.reload()}>重新加载页面</button>
    </div>;
  }
}
