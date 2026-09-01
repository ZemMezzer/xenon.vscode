# Xenon for Visual Studio Code

Xenon language support for Visual Studio Code, powered by the official `xenon lsp` language server.

## Requirements

- Visual Studio Code 1.96 or newer.
- Xenon installed with `xenon` available in `PATH`.

If Xenon is installed elsewhere, set `xenon.executablePath` to the exact executable path, for example `C:\Tools\Xenon\xenon.exe` or `/usr/local/bin/xenon`.

The installed extension does not require a separate Node.js, npm, TypeScript, or .NET SDK installation. The Xenon distribution itself supplies the compiler and Language Server.

## Features

- Lexical and semantic syntax highlighting.
- Preview highlighting, completion, hover and definition support for generic parameters, open and nested generic struct references, concrete generic-function and generic-struct specializations, `where` constraints and structural `template` declarations.
- Diagnostics.
- Hover information.
- Completion and signature help.
- Go to definition and type definition.
- Find references and implementations.
- Document outline and workspace symbols.
- Rename.
- Live synchronization of `.xe`, `.xeproj`, and `.xws` changes.

Semantic editor intelligence comes from `xenon lsp`; the extension does not duplicate compiler or project-system logic.

## Workspaces

Open a folder or multi-root workspace containing any supported Xenon layout:

- loose `.xe` source files;
- a `.xeproj` project;
- an `.xws` workspace.

Only `.xe` is registered as a source-code language. Project and workspace files are watched and forwarded to the Language Server.

Because the current Language Server is single-root, the extension starts one isolated `xenon lsp` process per VS Code workspace folder. Each process receives only the documents and file changes under its own folder. Open `.xe` files outside every workspace folder use a separate standalone client, including when the window already contains one or more project roots. Once created, the standalone client remains safely idle until extension deactivation, participates in restart/configuration changes, and never attaches project-file watchers or claims files owned by workspace folders.

When the VS Code workspace-folder list changes, the extension fully stops and rebuilds every Xenon client. Currently open documents are then synchronized only to the client selected by the new topology. This guarantees clean folder-to-standalone, standalone-to-folder, and nested-root ownership transfers without leaving stale document state in retired Language Servers.

## Commands

Open the Command Palette and run:

- **Xenon: Restart Language Server**
- **Xenon: Show Language Server Output**

## Troubleshooting

### Xenon executable was not found

Confirm that `xenon` runs from a new terminal in the same environment used to launch VS Code. Otherwise, set **Xenon: Executable Path** (`xenon.executablePath`) to the exact executable path and restart the Language Server.

### The server exits or a feature does not respond

Run **Xenon: Show Language Server Output** for technical details, then run **Xenon: Restart Language Server**. Automatic crash-loop restarts are intentionally disabled.

### Changes to executablePath

Changing `xenon.executablePath` while the extension is active stops the current server and starts a fresh `xenon lsp` process.
