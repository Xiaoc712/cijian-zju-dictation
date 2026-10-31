# 来源、署名与使用范围

## 原项目及参考

- 原项目：[Lucent-Snow / ZJU-English-dictation-tool](https://github.com/Lucent-Snow/ZJU-English-dictation-tool)，原作者 **Lucent_Snow**。Windows App 在原项目的数据模型、程序结构和词库基础上改进；小程序将相应学习功能重新实现为微信原生界面。本仓库是改进／移植版本，不将原作归为本仓库原创。
- 原项目 README 提及的参考工具：[e志大英默写器](https://eng.zjueva.net/)。本仓库沿用该来源关系说明，不声称与相关组织合作或获得官方授权。
- 第一册补充词库的本地转换来源：[ADSR1042 / SQTP2022](https://github.com/ADSR1042/SQTP2022) 的词书数据及新编大学英语第四版相关词书格式；第二、三册沿用原项目 CSV。教材释义、例句和相关内容的权利属于相应权利人。原始词库经整理去重后，两版都提供2616个学习词条。

## 音标与依赖

- [skywind3000 / ECDICT](https://github.com/skywind3000/ECDICT)：MIT；[open-dict-data / ipa-dict](https://github.com/open-dict-data/ipa-dict) 中 en_US 数据：MIT。完整许可见 wechat-mini/third-party，同时嵌入音标数据文件。
- 个别音标的词典核对链接保存在 wechat-mini/scripts/phonetic-overrides.json；详情见 wechat-mini/third-party/音标说明.md。此处没有宣称获得词典整体授权。
- Windows 使用 Python、PyQt6 / Qt、PyInstaller；各依赖保留其自身许可。图标采用本项目已选定的蓝紫色“词”字设计，正误提示音由本项目脚本合成。

## 署名和许可边界

保留已有“仅供学习，请勿商用”和原作者署名。不因本仓库公开而给上游代码、教材词库或第三方数据重新授予 MIT 等统一许可；使用和再分发应保留相关来源及各自的权利、许可条件。本仓库面向浙大学生个人学习，不是浙江大学官方出品。

原项目 README 中已有的 AI 致谢包括 Claude Code、Gemini 2.5 Pro、MiniMax M2；该记录属于原项目作者的说明。本仓库本次整理、移植与改进另按维护者要求致谢 GPT-6.1 Sol。

感谢 GPT-6.1 Sol。
