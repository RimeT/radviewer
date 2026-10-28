# RadViewer

[English](README.en.md)

在本机打开 DICOM、NIfTI 和 NRRD。横断、矢状、冠状和三维在同一页，配套 mask 按类别上色。只读取你给出的绝对路径。

## 界面

填一个文件夹的绝对路径，点 Scan。列表包含这一层和下一层子目录里的检查。标着 Mask 的卡片有配套标注。

打开后是三平面和三维。十字线跟着当前层走，角上的字母是 LPS 方向。CT 有 Soft、Lung、Bone、Native，也可以在切面上拖动调窗。读数是窗宽、窗位和十字线处的像素值。

mask 与影像放在同一目录：`image` 配 `mask`，或 `名字` 配 `名字-label`，两边要是同一类格式。同一层的 `data` 和 `mask` 文件夹里，同名体积也会配成一套。Class 0 不显示。其余类别可以单独开关，Opacity 调透明度。

切面下方的滑条用来换层。左键拖动调窗，中键平移，右键缩放，单击移动十字线。在三维格里拖动可以旋转，滚轮缩放。Reset 回到初始视角。Studies 回到列表。

## 示例

![cas045 的轴位、矢状位、冠状位与三维血管](docs/cas045.png)

截图所示为 MICCAI 2023 Cerebral Artery Segmentation Challenge（CAS 2023）训练病例 cas045。该挑战的任务是在症状性颅内动脉狭窄患者的三维 TOF-MRA 上分割脑动脉。

> Huijun Chen, Xihai Zhao, Haozhong Sun, Jiaqi Dou, Chenlin Du, Runyu Yang, Xiaoqi Lin, Shuwan Yu, Jiachen Liu, Chun Yuan, Niranjan Balu. Cerebral artery segmentation Challenge, MICCAI 2023. Zenodo. [https://doi.org/10.5281/zenodo.7839969](https://doi.org/10.5281/zenodo.7839969)

- 数据说明：[10.5281/zenodo.7839970](https://doi.org/10.5281/zenodo.7839970)
- 竞赛：[Codalab](https://codalab.lisn.upsaclay.fr/competitions/9804)
- 介绍：[SMRA CAS 2023](https://society4mra.org/cerebral-artery-segmentation-challenge-cas2023/)

## 用法

对助手给出本机绝对路径，例如 `D:/studies/case`。

- `list_studies` 列出该目录和一层子目录里的检查。
- `open_study` 打开一个文件，或打开文件夹里的第一套。

RadViewer 页面在 MiniMax Code 的会话右侧，也在 Zcode 的会话侧栏。ChatGPT Work 桌面版调用同一个本地工具，并收到选中的路径。网页版 ChatGPT Work 跑不了这个本地进程。本机需要能运行 `node`。

### MiniMax Code

仓库根目录有 `.minimax-plugin/plugin.json`。桌面端从 GitHub 安装时使用：

https://github.com/RimeT/radviewer

也可以把仓库放到本机插件目录后重启。这一层要能直接看到 `.minimax-plugin`。启用后，从会话右侧的面板打开 RadViewer。

```text
%USERPROFILE%\.minimax\plugins\radviewer
```

macOS 和 Linux 是 `~/.minimax/plugins/radviewer`。打开 RadViewer，或对助手说「在 RadViewer 里打开 D:/studies/case」。

### Zcode

Settings → Plugins → Create → Add marketplace，填 `RimeT/radviewer`。在 Personal 里安装 radviewer 并启用。会话侧栏里会出现 RadViewer。可以在页面里填绝对路径并点 Scan，也可以让助手打开一个路径。

### ChatGPT Work 桌面版

```bash
codex plugin marketplace add RimeT/radviewer
```

重启桌面端，在插件目录里选择 RadViewer 并安装。

## 本地预览

```bash
npm install
npm run dev
```

打开 http://localhost:5173 ，填绝对路径，点 Scan。`npm run build` 会更新随包发布的页面。

## 目录

```text
.
├── .minimax-plugin/plugin.json          MiniMax Code
├── radviewer.mcp.json
├── miniapp/
├── .zcode-plugin/plugin.json            Zcode 会话侧栏
├── marketplace.json
├── .mcp.json
├── chatgpt/plugin.json                  ChatGPT Work 桌面版
├── chatgpt/mcp.json
├── .agents/plugins/marketplace.json
├── skills/radviewer/SKILL.md
└── docs/
```

MIT。三维渲染使用 three.js，同样是 MIT。
