import * as vscode from "vscode";
import type { XenonLanguageClientManager } from "./languageClient";
import { RestartScheduler } from "./restartScheduler";

export function registerCommands(
  context: vscode.ExtensionContext,
  manager: XenonLanguageClientManager,
  restarts: RestartScheduler
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("xenon.restartLanguageServer", async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Restarting Xenon Language Server..."
        },
        () => restarts.request("user command")
      );
    }),
    vscode.commands.registerCommand("xenon.showLanguageServerOutput", () => {
      manager.showOutput();
    })
  );
}
