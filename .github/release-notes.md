这是糕糕桌宠 v1.0.1 Windows 启动修复版。应用仍未进行 Apple 公证或 Windows Authenticode 签名，请只从本仓库 Releases 页面下载并核对 SHA-256。

- 修复首次安装或关闭“开机启动”时显示“糕糕没能醒来：系统找不到指定的文件（os error 2）”的问题。
- 关闭开机启动现在是幂等操作：对应 Windows 注册表值尚不存在时会直接视为已关闭，不再让应用启动失败。
- Windows NSIS 安装包现在内置 Evergreen WebView2 离线安装程序；即使当前账户没有 WebView2 或安装时无法联网，也能自动补齐运行环境。
- Windows v1.0.1 使用与 v1.0.0 相同的应用标识、产品名和安装范围。直接运行新安装包并采用默认升级选项即可，无需手动卸载；不要勾选“删除应用数据”，即可保留本机设置、成长比例和最后位置。
- macOS 继续提供同时支持 Apple Silicon 与 Intel 的 Universal `.dmg` 和 `.app.tar.gz`。
- 使用 `SHA256SUMS.txt` 核对所有安装包完整性。

应用完全离线运行，不依赖 Codex、Python、账户或网络服务。Windows 安装包因内置 WebView2 离线运行时而明显增大；应用运行时本身不会发送网络请求。
