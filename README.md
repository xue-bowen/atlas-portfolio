# Atlas Portfolio

Atlas Portfolio 是一个浏览器本地运行的多币种投资组合账本。它记录人民币入金、换汇、美元证券交易、股息和费用，并计算持仓成本、已实现损益、人民币组合价值、XIRR、美元 TWR，以及与 IVV、QQQ 的价格变化比较。

当前处于公开试用准备阶段。应用没有账户或云端账本；每个浏览器来源（协议、域名、端口）各自保存数据。首次打开显示匿名演示账本，开始记录前请点击 **Start with an empty personal ledger**。

## 本地运行

需要 Node.js 20.19+ 或 22.12+、npm，以及现代浏览器。

```bash
git clone https://github.com/xue-bowen/atlas-portfolio.git
cd atlas-portfolio/web
npm ci
npm run dev
```

打开终端显示的本地地址。`npm test` 运行计算与导入测试，`npm run build` 生成静态站点，`npm run lint` 检查代码。

## 使用与数据

交易录入按日期重新排序，整条时间线会在保存前校验。Settings 中的 **Export JSON backup** 可保存本地备份；**Import JSON backup** 会完整替换当前账本与证券资料；**Merge transactions** 可预览并合并 Atlas JSON 或[通用 CSV](docs/CSV_IMPORT.md)。合并时相同 ID 的同一事件会跳过，冲突或无效时间线会被拒绝。大量补录前请先导出备份。

交易、证券资料和行情缓存存于浏览器。清除站点数据、更换浏览器/设备或切换来源不会自动迁移它们；需要自己导出并导入 JSON 备份。[隐私与网络请求说明](docs/PRIVACY.md)列出了存储位置和第三方行情服务。

IVV 与 QQQ 目前使用**未复权收盘价变化**，未计入分红，因此不能视为与含外部现金流调整的组合 TWR 完全同口径的总回报比较。详见[收益口径](docs/PERFORMANCE_METRICS.md)。行情和汇率仅供参考；缺少所需数据时，应用会显示不可计算，而不是填入零。

仓库只能包含源码、匿名示例和文档；请勿提交真实交易、账户号码、券商报表、API 密钥或个人备份。

## 许可证

项目源码采用 [MIT License](LICENSE)。第三方行情、汇率和外部网站内容不属于本项目许可证授权范围。
