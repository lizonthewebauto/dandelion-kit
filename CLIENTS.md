# Set up the Kit in your app

The Kit runs on your computer. It needs an app that can start a local MCP server. MCP is how the app calls the Kit's tools. A chat app that accepts only a web server URL cannot start this Kit on its own.

You need Node.js 20.9.0 or newer. Video editing also needs ffmpeg with captions. The Kit's `doctor` tool checks this for you. Setup does not sign in to Dandelion, link social accounts, or post anything.

## Pick a route

| App | Route | After setup |
| --- | --- | --- |
| Claude Desktop | Open the matching `.mcpb` release file, or use `setup claude-desktop` from a source copy | Fully quit and reopen the app |
| Claude Code | Plugin install in [INSTALL.md](INSTALL.md), or run the command printed by `setup claude-code` | Start a new session and check `/mcp` |
| Codex CLI or desktop app | Plugin install in [INSTALL.md](INSTALL.md), or run the command printed by `setup codex` | Restart the app or session and check MCP servers |
| Cursor desktop | `setup cursor` | Reload the app and check its MCP settings |
| VS Code with an MCP client | Follow `setup vscode`: choose a config file on Windows, or run its command on macOS and Linux | Restart the server from MCP: List Servers |
| Another local MCP app | `setup generic`, then add the shown entry to that app | Follow that app's MCP steps |
| A browser or phone by itself | No direct local install | Use a supported local app, or a remote view of a local session |

These are ways to add the server. Your app's rules may still block local tools or require a trust step. A tool can return text and file paths even when the app does not show its cards.

## Computer support

| Computer | Install route | Runtime checks |
| --- | --- | --- |
| Windows x64 | Source or Windows x64 `.mcpb` | Full Kit path checked, including Reels |
| Apple silicon Mac | Source or Apple silicon `.mcpb` | Full Kit path checked, including Reels |
| Intel Mac | Source or Intel `.mcpb` | Images and carousels work. Speech and Reel editing do not run yet. |
| Linux x64 or arm64 | Source | Setup route is provided. The full native runtime has not been checked on these systems. |
| Windows ARM64 | Source | Setup route is provided. The full native runtime has not been checked on this system. |

There is no Linux or Windows ARM64 `.mcpb` release file. A source route does not promise that every native package or video tool will work on that system. Run `doctor` and read its result.

## Set up from a source copy

Install Git and Node.js, then run:

```text
git clone https://github.com/lizonthewebauto/dandelion-kit.git
cd dandelion-kit
node bin/kit.mjs setup cursor
```

Replace `cursor` with `claude-desktop`, `claude-code`, `codex`, `vscode`, or `generic`. Claude Desktop and Cursor setup can update a config file. Claude Code and Codex print a command for you to run. Default VS Code setup prints config steps on Windows or a command on macOS and Linux. Printed steps do not register the server. Generic setup prints JSON only. The first Kit start installs its own packages. You do not need to run `npm install` first.

Keep this folder where it is. Setup uses the full paths to this copy and the Node program that ran it. If you move the folder, run setup again from its new place. If you already use the Kit through a plugin or bundle, keep that route rather than adding a second copy.

To see what setup would do without changing a config:

```text
node bin/kit.mjs setup cursor --dry-run
```

For an existing Kit entry you mean to change:

```text
node bin/kit.mjs setup cursor --replace
```

When setup writes JSON, it keeps other server entries and settings. It refuses a different existing Kit entry unless you pass `--replace`. It does not change another server's name or settings. If the config cannot be read, it stops so the file can be fixed. It does not rewrite the whole file with a blank config. `--replace` does not remove entries in Claude Code, Codex or VS Code through their commands. Use that app's own MCP settings if you need to remove an old entry.

## Claude Desktop

For the simplest route, get the matching file from [releases](https://github.com/lizonthewebauto/dandelion-kit/releases/latest). In Claude Desktop, open Settings, Desktop app, then Manage next to Extensions. In Advanced settings, choose Install Extension and pick the `.mcpb` file. Some app versions show Extensions directly in Settings. [Official extension steps](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

For source setup, `setup claude-desktop` adds `dandelion-kit` under `mcpServers` in:

| System | Config file |
| --- | --- |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

These are the paths in the [official MCP guide](https://modelcontextprotocol.io/docs/2026-07-28/develop/build-server). If your app uses a different file, use its Settings to find the right file, then pass the full path:

```text
node bin/kit.mjs setup claude-desktop --config "/full/path/to/claude_desktop_config.json"
```

## Claude Code and Codex

`setup claude-code` prints Claude Code's own `claude mcp add` command with stdio transport and user scope. Run that command to make the Kit available across projects. Registration needs the `claude` command on your path. [Claude Code MCP steps](https://code.claude.com/docs/en/mcp)

`setup codex` prints `codex mcp add` for you to run. Registration needs the `codex` command on your path. Codex stores MCP settings in `~/.codex/config.toml`, shared by its local app, CLI and IDE extension. [Official OpenAI MCP steps](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

These routes do not run the command for you or edit the app's settings. If an app command is missing, install that app or use its normal MCP settings to add the server entry shown by `setup generic`.

On Windows, run the printed MCP command in PowerShell. If a source path has shell marks that could change a command, setup prints fixed plugin install commands instead. Use those steps rather than trying to paste that path into a command yourself.

## Cursor

`setup cursor` merges a `dandelion-kit` entry into `~/.cursor/mcp.json`, under `mcpServers`. The entry has `type: stdio`, the full Node path, and the full Kit script path. For a project file instead:

```text
node bin/kit.mjs setup cursor --config "/full/path/to/project/.cursor/mcp.json"
```

Both the global and project locations are in the [Cursor MCP guide](https://cursor.com/docs/mcp).

## VS Code

On macOS and Linux, `setup vscode` prints a `code --add-mcp` command. Run it to add the server to your VS Code user profile. Registration needs the `code` command on your path.

On Windows, setup prints config steps and a `servers` JSON entry instead. It does not print the `code --add-mcp` command, since Windows command wrappers can drop quotes from that JSON. Use VS Code's MCP: Add Server command, or write a chosen JSON file with `--config`:

```text
node bin/kit.mjs setup vscode --config "/full/path/to/project/.vscode/mcp.json"
```

On Windows PowerShell, use a Windows path, for example:

```powershell
node bin/kit.mjs setup vscode --config "C:\Projects\My Project\.vscode\mcp.json"
```

This file uses a top-level `servers` object. VS Code also has a newer portable Copilot format with `mcpServers`; it is a different format. Do not pass that portable file to this setup route. [VS Code MCP reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

If an existing VS Code file has comments or other JSON syntax that setup cannot read, use VS Code's MCP: Add Server command instead of removing the comments or replacing the file.

## Another local app

Run `node bin/kit.mjs setup generic`. It prints a local server entry without changing any config. Add it in your app's MCP settings. The core is:

```json
{
  "command": "/full/path/to/node",
  "args": ["/full/path/to/dandelion-kit/bin/kit.mjs", "serve"]
}
```

The setup output uses your real full paths. On Windows the command will be a path to `node.exe`. Each app has its own outer config shape, so use its own guide. Do not paste a local file path into a field that asks for a server URL.

## Browser, mobile and remote sessions

The Kit's local editor is a stdio server, not a public web service. A browser or phone cannot use it just by adding a URL. Claude Code Remote Control can let you use a session on your own computer from a phone or browser, keeping that session's local tools. That computer and session still run the Kit. [Remote Control guide](https://code.claude.com/docs/en/remote-control)

Claude's remote custom connectors connect from Anthropic's cloud to a public server. They cannot point to this Kit's local command. [Remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

The optional Dandelion web server at `https://dandelionapp.io/api/mcp` is for Dandelion tools. It is not the Kit's local image or video editor. Sign in later in your browser only if you choose to use Dandelion. You do not need an account to make local files or see the post card.

With WSL, SSH, a container, or another remote runtime, run the Kit where the MCP client starts local commands. Paths, Node, ffmpeg and files must exist there. A Windows file path is not a Linux file path.

## Check the result

1. If setup printed a command, run that command first. Then restart or reload your chosen app so it reads the new server entry.
2. Find `dandelion-kit` in its MCP server list. Allow the app's normal trust step if it asks.
3. Ask the app to call the Kit's `doctor` tool. Read what it says about Node, ffmpeg and speech support. You can also run `node bin/kit.mjs doctor` from the source folder.
4. If ffmpeg is missing, use the command `doctor` gives for your computer. Then check again.

Do not sign in, connect accounts, upload files, or send a test post as part of setup. Making a real post is a later choice and needs your yes for that exact post.
