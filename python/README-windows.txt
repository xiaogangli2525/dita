Blink 离线知识库 · Windows x64 Python 版

使用已安装的 Windows x64 Python 3.12。包内附带检索依赖、模型和已经生成的索引，使用时无需联网。
完整解压后，在 blink-kb 文件夹打开 PowerShell，执行

  .\blink-kb.cmd "支持多少串口"
  .\blink-kb.cmd "支持多少串口" --search semantic --json
  .\blink-kb.cmd --info
  .\blink-kb.cmd --help

启动脚本默认通过 py -3.12 查找解释器。如 Python 启动器不可用，可把 Python 3.12 的 python.exe
完整路径设置到 BLINK_PYTHON，再执行上述命令。如果同事收到的是已封装的 blink-cli.exe，
请由该工具维护者在构建时把 blink_kb 模块加入现有命令，并显式打包同架构依赖和共享检索规则。

如包含阅读页，双击 blink-reader.cmd，复制命令窗口中的本机地址到浏览器。
保持窗口开启，输入问题后按回车进行混合检索。直接打开 docs/index.html 可以离线阅读和关键词检索。

更换文档时完整替换 docs 目录。也可以通过 --kb 指定支持的 ZIP、目录或 knowledge.json。
