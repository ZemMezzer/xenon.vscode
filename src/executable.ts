export const DEFAULT_EXECUTABLE = "xenon";

export type ExecutableSource = "configuration" | "path";

export interface ExecutableSelection {
  readonly command: string;
  readonly source: ExecutableSource;
}

export type StartupFailureKind = "not-found" | "permission-denied" | "other";

export function selectExecutable(configuredPath: unknown): ExecutableSelection {
  if (typeof configuredPath === "string") {
    const exactPath = configuredPath.trim();
    if (exactPath.length > 0) {
      return { command: exactPath, source: "configuration" };
    }
  }

  return { command: DEFAULT_EXECUTABLE, source: "path" };
}

export function classifyStartupFailure(error: unknown): StartupFailureKind {
  const code = getErrorCode(error);
  if (code === "ENOENT") {
    return "not-found";
  }
  if (code === "EACCES" || code === "EPERM") {
    return "permission-denied";
  }

  const message = getErrorMessage(error).toLowerCase();
  if (message.includes("enoent") || message.includes("not found") || message.includes("cannot find")) {
    return "not-found";
  }
  if (message.includes("eacces") || message.includes("permission denied") || message.includes("access is denied")) {
    return "permission-denied";
  }

  return "other";
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : undefined;
}
