<p align="center"><img src="wechat-mini/miniprogram/assets/logo.png" width="96" alt="词间默写图标"></p>

# 词间默写 · ZJU 大英默写器

**给浙大学生服务的大英背诵与默写工具。** 帮助同学按词书、单元记忆大学英语单词和短语，进行拼写自测、生词复习和熟词管理。包含 **微信小程序版** 和 **Windows App 版**，三册共 **2616 个词条**。

本仓库是原大英默写器的改进与微信移植版本，保留原作者 **Lucent_Snow** 署名；项目来源、补充词库与第三方许可见 [NOTICE.md](NOTICE.md)。本项目由同学个人维护，不是浙江大学官方产品。

## 选择版本

| 版本 | 使用设备 | 入口 | 学习记录 |
| --- | --- | --- | --- |
| 微信小程序 | 手机、平板的微信 | [小程序源码与导入说明](wechat-mini/README.md) | 默认本机保存，JSON备份迁移 |
| Windows App | Windows电脑 | 仓库 Releases 的 Windows 下载包，或 [运行源码](desktop-app/README.md) | 本机 JSON 文件 |

App 版指 Windows 桌面应用；当前不提供 Android APK 或 iOS 安装包。两版功能各自演进，不宣称完全一致。

## 主要功能

- 按词书／单元学习，提供单词、短语默写及例句填空；支持顺序与随机练习。
- 答案忽略大小写与空白，回退上一词、跳过当前词；回退保留输入和本轮顺序。
- “斩”熟词后排除后续测试，支持熟词查看、恢复及撤销。
- 自动记录答错词条，复习时答对才移除；学习进度在当前设备保存。
- 现代蓝紫色界面，面向日常自测、考前复习及碎片时间学习。

小程序另外提供中英对照背诵、三种显示模式、离线音标、连续点击逐卡标记、右滑操作、标记排序、当前单元批量清零、生词本、深浅模式、正误音效和学习备份。小程序空答案可直接提交并计错；Windows当前空答案不提交。

## 开始使用

**微信小程序：** 开发者工具导入 wechat-mini，编译并预览。默认无需登录、服务器或云开发；自行发布请使用自己的 AppID。手机和平板分别保存记录。

**Windows：** 从本仓库 Releases 下载 Windows ZIP，完整解压，保留 `_internal/` 和 `data/`，双击“大英默写器_美化版.exe”。开发者可在 desktop-app 安装依赖后运行 `python main.py`。

## 目录

```text
wechat-mini/    原生微信小程序、音标数据、测试及重建脚本
desktop-app/    Python / PyQt6桌面程序、CSV词库及测试
shared/        小程序核心对应的TypeScript源文件
NOTICE.md      原作者、词库来源和第三方许可说明
```

## 验证

- 小程序：在 wechat-mini 运行 `node --test tests/*.test.cjs`、`node scripts/validate.cjs`。
- Windows：在 desktop-app 安装 requirements.txt 后运行 `python -m unittest discover -s tests -v`。
- 本次整理保留83项小程序测试和31项Windows测试；具体运行结果以实际执行为准。真机体验、微信发布及账号分享能力需在各自环境验证。

仓库不包含个人学习记录、私有微信开发者配置、构建缓存、授权凭据或后台备案材料。英文卡片点读尚未启用；分享入口已配置，是否可用以微信账号实际状态为准。

## 来源与致谢

原作者：[Lucent_Snow](https://github.com/Lucent-Snow)，原项目：[ZJU-English-dictation-tool](https://github.com/Lucent-Snow/ZJU-English-dictation-tool)。第一册补充词库参考 [SQTP2022](https://github.com/ADSR1042/SQTP2022)；音标使用 ECDICT 与 ipa-dict 的相应许可数据。详见 [来源及使用范围](NOTICE.md)。保留原作已有署名和致谢，新增本版本整理与改进说明。

感谢 GPT-6.1 Sol。
