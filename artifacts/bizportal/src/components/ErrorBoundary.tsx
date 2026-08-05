import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string;
  logToBackend?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const label = this.props.label ?? "unknown";
    console.error(`[ErrorBoundary – ${label}]`, error, info.componentStack);

    if (this.props.logToBackend !== false) {
      try {
        const route = typeof window !== "undefined" ? window.location.href : "";
        fetch("/api/logs/client-error", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error_message: error.message ?? String(error),
            stack_trace: (error.stack ?? "") + "\n\nComponent Stack:" + (info.componentStack ?? ""),
            route,
            component: label,
            severity: "high",
            metadata: { componentStack: info.componentStack },
          }),
        }).catch((_e) => {});
      } catch (_e) {
        // never let reporting crash the boundary itself
      }
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <p className="font-semibold text-destructive">Terjadi Kesalahan</p>
            {this.props.label && (
              <p className="text-sm text-muted-foreground">{this.props.label}</p>
            )}
            {this.state.error && (
              <p className="mt-1 text-xs text-muted-foreground opacity-70">
                {this.state.error.message}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            <RefreshCw className="h-4 w-4" />
            Coba Lagi
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  label: string,
  logToBackend = true,
) {
  const Wrapped = (props: P) => (
    <ErrorBoundary label={label} logToBackend={logToBackend}>
      <Component {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `WithErrorBoundary(${label})`;
  return Wrapped;
}
