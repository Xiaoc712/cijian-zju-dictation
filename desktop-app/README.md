# 大英默写器 · Windows App 版

面向浙大学生的大英单词、短语默写与错题复习工具，使用 Python / PyQt6，包含三册 CSV 词库。此目录是 Windows 桌面 App，不是 Android APK 或 iOS 安装包。

- 单词默写、例句填空，支持词书／单元选择、首字母提示、顺序／乱序。
- 忽略答案中的大小写和所有空白；↑ 上一词，↓ 跳过，回退保留草稿及本轮顺序。
- “斩 · 已熟知”排除熟词，Ctrl+K 斩词，Ctrl+Shift+Z 撤销；熟词库可搜索和恢复。
- 错题自动保存；复习时答对移除，跳过或退出保留。统计按每题最新结果更新。
- 设置与学习记录保存在本机，原子写入、异常文件保留备份。

桌面版当前不提交空答案；小程序的空白计错、背诵标记及深色模式属于小程序功能，两版未宣称完全一致。

## 运行源码

建议 Python 3.14。在当前目录运行：

```powershell
python -m pip install -r requirements.txt
python main.py
```

`data/` 必须与 `main.py` 同级；程序运行后生成 wrong_words.json、mastered_words.json、preferences.json 等本机文件，不随仓库发布。

## 使用 Windows 下载包

在仓库 Releases 下载 Windows ZIP，完整解压到可写目录，双击“大英默写器_美化版.exe”。保留旁边的 `_internal/`、`data/`，无需安装 Python。源码中的 build.ps1 可用于重新打包：

```powershell
python -m pip install -r requirements-build.txt
./build.ps1
```

测试：`python -m unittest discover -s tests -v`。UI 测试使用临时记录目录，不操作已有学习记录。

来源及使用范围见仓库根目录 [NOTICE.md](../NOTICE.md)。原作者 Lucent_Snow；本版在原项目基础上改进界面、导航及熟词管理，保留原有署名。

感谢 GPT-6.1 Sol。
