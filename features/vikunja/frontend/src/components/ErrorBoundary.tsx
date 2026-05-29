import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-app-danger bg-app-surface px-3 py-2 text-sm text-app-danger">
          <div className="font-semibold">{this.props.fallbackTitle ?? "Something went wrong"}</div>
          <div className="mt-1 text-xs">{this.state.error.message}</div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-app-text-muted">
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
