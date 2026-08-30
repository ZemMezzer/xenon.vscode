export interface RoutableDocument {
  readonly languageId: string;
  readonly uri: {
    readonly scheme: string;
  };
}

export function isXenonFileDocument(document: RoutableDocument): boolean {
  return document.languageId === "xenon" && document.uri.scheme === "file";
}

export function isOutsideWorkspaceXenonDocument<T extends RoutableDocument>(
  document: T,
  hasWorkspaceFolder: (document: T) => boolean
): boolean {
  return isXenonFileDocument(document) && !hasWorkspaceFolder(document);
}

export function needsStandaloneClient<T extends RoutableDocument>(
  documents: readonly T[],
  hasWorkspaceFolder: (document: T) => boolean
): boolean {
  return documents.some((document) => isOutsideWorkspaceXenonDocument(document, hasWorkspaceFolder));
}
