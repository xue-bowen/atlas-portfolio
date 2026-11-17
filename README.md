# Atlas Portfolio

Atlas Portfolio 是一个浏览器本地运行的多币种投资组合账本。它记录人民币入金、换汇、美元证券交易、股息和费用，并计算持仓成本、已实现损益、人民币组合价值、XIRR、美元 TWR，以及在具备调整后收盘价时与 IVV、QQQ 的回报比较。

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

IVV 与 QQQ 比较使用**分红及拆股调整后收盘价**，本地已有完整调整数据时优先使用，否则从配置的 Yahoo Finance 来源自动获取；起止值保持同一来源。缺少调整值时显示不可用，不以未复权价格代替。CSV 解析、存储与历史估值接入已完成，但浏览器行情导入界面仍暂缓。详见[行情 CSV 说明](docs/MARKET_PRICE_CSV.md)和[收益口径](docs/PERFORMANCE_METRICS.md)。行情和汇率仅供参考；缺少所需数据时，应用会显示不可计算，而不是填入零。

本地 `npm run dev` 已启用 Yahoo Finance 日线请求桥，失败时回退东方财富和现有缓存。当前网络实测 Yahoo 返回 HTTP 403，因此尚不能宣称完整自动行情已就绪。静态托管需要另行配置 Yahoo 请求桥；用法和验证边界见[Yahoo Finance 接入说明](docs/YAHOO_FINANCE.md)。本项目按非商业原型继续开发，完整行情就绪后再公开。

仓库只能包含源码、匿名示例和文档；请勿提交真实交易、账户号码、券商报表、API 密钥或个人备份。

## 许可证

项目源码采用 [MIT License](LICENSE)。第三方行情、汇率和外部网站内容不属于本项目许可证授权范围。
