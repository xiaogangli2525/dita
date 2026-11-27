Blink 离线知识库 · Windows x64

只看手册、目录和关键词：直接双击 docs\index.html。
使用向量搜索：首次安装请双击 setup-reader.cmd。窗口会显示 Python 路径、模型目录、手册数量，以及命令行和本机网页的检索检查结果。请等到“安装验证完成”，再启动 blink-reader.cmd。按 Ctrl+C 可停止本机服务。

新电脑（包括不能上网的电脑）
1. 完整解压文档包，再把 Blink-KB-Windows-x64-Setup 解压到同一父目录，合并其中的 blink-kb 文件夹，允许覆盖旧启动脚本。解压后应同时看到：
   blink-kb\docs\knowledge.json
   blink-kb\setup-reader.cmd
   blink-kb-runtime\python\python.exe
2. 双击 blink-kb\setup-reader.cmd。运行包已带专用 Python、全部检索依赖和模型，可以直接断网验证。公司电脑如果报本机 DLL 加载错误，请让 IT 核对 Microsoft Visual C++ v14 x64 运行库。可提前从 https://aka.ms/vc14/vc_redist.x64.exe 下载官方安装程序，带入内网。
3. 更新手册时只替换整份 blink-kb\docs，保留启动脚本和 blink-kb-runtime。再次运行 setup-reader.cmd 即可验证新手册。

已有 Windows x64 CPython 3.12 的联网电脑
可以使用轻量文档包，在 blink-kb 同级放原始 Blink-KB-Models-bge-small-zh-v1.5.zip，运行 install-deps.cmd。首次安装在 blink-kb\.venv 内按哈希安装依赖，请把文档解压到可写目录。自备离线 wheels 可全部放在 blink-kb\wheelhouse，此时安装只用本地文件。BLINK_PYTHON 可指定基础解释器的完整路径。加载顺序为配套运行包、专用 .venv、BLINK_PYTHON、py -3.12、python。附带 _vendor 和模型的旧全量版也支持直接使用同架构 CPython 3.12。

模型与故障处理
BLINK_MODELS 可指定绝对路径，应指向包含 Xenova 目录的父目录。安装与检索使用同一位置；默认优先使用文档包自带的模型，其次使用 %LOCALAPPDATA%\Blink\models。BLINK_MODEL_PACKAGE 可指定单独的模型 ZIP 或含 models\Xenova 的解压目录。首次安装会校验 5 个模型文件并修复损坏的副本，重复安装复用通过校验的文件。
如窗口提示 BLINK_KB 指向另一份手册，请临时清除这个变量后再验证随包文档。在 PowerShell 中可执行 Remove-Item Env:BLINK_KB，然后重新运行安装。模型路径不可写时可把 BLINK_MODELS 设到用户可写的绝对路径。

在 blink-kb 目录打开 PowerShell：
  .\blink-kb.cmd "支持多少串口" --search semantic
  .\blink-kb.cmd "支持多少串口"
  .\blink-kb.cmd --info
  .\blink-kb.cmd --help
已集成到团队 blink-cli 的环境使用 blink-cli kb "支持多少串口" --search semantic。
