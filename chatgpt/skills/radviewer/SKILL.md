---
name: radviewer
description: Open a DICOM, NIfTI, or NRRD radiology study. Use when the user points at a .dcm series, a .nii or .nii.gz volume, or a .nrrd, .nrrd.gz, or .nhdr file, including a paired mask.
---

# RadViewer

Pass an absolute path. Do not decode the pixels.

- `list_studies` lists the studies in a directory and one level of subfolders.
- `open_study` selects one study. MiniMax Code shows it on the right-hand RadViewer page. Zcode shows it in the session sidebar. ChatGPT Work receives the selected path.

A mask sits beside the image: `image` with `mask`, or `name` with `name-label`, same directory and same format family. A `data` folder and a sibling `mask` folder with the same filename are also paired. Class 0 is hidden.
