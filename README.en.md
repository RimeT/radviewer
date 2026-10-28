# RadViewer

[中文](README.md)

Open DICOM, NIfTI, and NRRD on this machine. Axial, sagittal, coronal, and 3D share one page, and a paired mask is colored by class. The app reads only the absolute path you give it.

## The page

Enter an absolute folder path and choose Scan. The list includes studies in that folder and one level of subfolders. A card marked Mask has a paired label.

A study opens as three planes plus 3D. The crosshair follows the current slice, and the corner letters are LPS directions. CT studies offer Soft, Lung, Bone, and Native. Dragging on a slice also changes the window. The readout is window width, window level, and the value under the crosshair.

Put the mask beside the image: `image` with `mask`, or `name` with `name-label`, same directory and same format family. A `data` folder and a sibling `mask` folder with the same filename are paired too. Class 0 stays hidden. The other classes can be toggled, and Opacity changes how strong they are.

The slider under a plane changes the slice. Drag with the left button to window, the middle button to pan, and the right button to zoom. Click to move the crosshair. Drag in the 3D cell to rotate, and use the wheel to zoom. Reset restores the view. Studies returns to the list.

## Example

![cas045: axial, sagittal, coronal, and 3D vessels](docs/cas045.png)

The figure shows training case cas045 from the MICCAI 2023 Cerebral Artery Segmentation Challenge (CAS 2023). The task is segmentation of cerebral arteries on 3D TOF-MRA in patients with symptomatic intracranial artery stenosis.

> Huijun Chen, Xihai Zhao, Haozhong Sun, Jiaqi Dou, Chenlin Du, Runyu Yang, Xiaoqi Lin, Shuwan Yu, Jiachen Liu, Chun Yuan, Niranjan Balu. Cerebral artery segmentation Challenge, MICCAI 2023. Zenodo. [https://doi.org/10.5281/zenodo.7839969](https://doi.org/10.5281/zenodo.7839969)

- Data record: [10.5281/zenodo.7839970](https://doi.org/10.5281/zenodo.7839970)
- Challenge: [Codalab](https://codalab.lisn.upsaclay.fr/competitions/9804)
- Overview: [SMRA CAS 2023](https://society4mra.org/cerebral-artery-segmentation-challenge-cas2023/)

## Use

Give the assistant an absolute path, such as `D:/studies/case`.

- `list_studies` lists the studies in that directory and one level of subfolders.
- `open_study` opens one file, or the first study in a folder.

The RadViewer page opens on the right in MiniMax Code and in the Zcode session sidebar. ChatGPT Work desktop uses local MCP to open the viewer beside the conversation. Use a locally running conversation; a cloud-only conversation cannot read paths on your computer. `node` has to be available.

### MiniMax Code

The repository root contains `.minimax-plugin/plugin.json`. For a GitHub install in the desktop app, use:

https://github.com/RimeT/radviewer

You can also copy the repository into the local plugin directory and restart. `.minimax-plugin` has to sit directly inside that directory. After it is enabled, open RadViewer from the panel on the right.

```text
%USERPROFILE%\.minimax\plugins\radviewer
```

On macOS and Linux the path is `~/.minimax/plugins/radviewer`. Open RadViewer, or ask the assistant to open `D:/studies/case` in RadViewer.

### Zcode

Settings → Plugins → Create → Add marketplace, and enter `RimeT/radviewer`. Install radviewer from Personal and enable it. RadViewer appears in the session sidebar. Enter an absolute path and choose Scan, or ask the assistant to open a path.

### ChatGPT Work desktop

```bash
codex plugin marketplace add RimeT/radviewer
```

Requires the ChatGPT desktop app, local execution, and Node.js 20 or later on PATH. The command registers the GitHub marketplace; users do not need to clone the repository or run npm install.

Restart the desktop app. In the Plugins Directory source picker, choose the RadViewer marketplace, then install and enable radviewer. Start a new locally running Work conversation, select RadViewer, and ask "Open RadViewer" or "Open D:/studies/case in RadViewer". You can also open it from the conversation side panel, enter an absolute path, and choose Scan. The panel entry requires client support for MCP Extensions; MCP Apps clients can also display the viewer from a tool call.

To update an older installation, refresh the marketplace, reinstall the plugin in the Plugins Directory, and start a new conversation:

```bash
codex plugin marketplace upgrade radviewer
```

The package ships the compiled viewer and local server with no dependencies outside its folder. Automated tests cover isolated installation, UI resources, file chunks, and volume decoding with string compilation disabled. Rendering inside the Work client still needs verification.

Distribution uses the GitHub plugin marketplace. This plugin has not been published to the OpenAI public directory.

## Local preview

```bash
npm install
npm run dev
```

Open http://localhost:5173 , enter an absolute path, and choose Scan. `npm run build` refreshes the page shipped with the package.

## Layout

```text
.
├── .minimax-plugin/plugin.json          MiniMax Code
├── radviewer.mcp.json
├── miniapp/
├── .zcode-plugin/plugin.json            Zcode session sidebar
├── marketplace.json
├── .mcp.json
├── chatgpt/plugin.json                  ChatGPT Work desktop
├── chatgpt/miniapp/                     Bundled runtime
├── chatgpt/mcp.json
├── .agents/plugins/marketplace.json
├── skills/radviewer/SKILL.md
└── docs/
```

MIT. The 3D view uses three.js, also MIT.
