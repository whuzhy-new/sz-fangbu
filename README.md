# 深圳房补地图

字节跳动深圳三个工区的预计算通勤范围，以及小区、地址和地图选点的高德路线核验。

## 运行

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_heavy_omega_sentinel.sql
npm run dev
```

本地访问 http://localhost:5173 。数据库迁移只需对新建的本地数据库执行一次。

在被 Git 忽略的 `.dev.vars` 中配置：

```dotenv
AMAP_WEB_KEY="Web服务 Key"
AMAP_JS_KEY="Web端 Key"
AMAP_JS_SECURITY_CODE="Web端安全密钥"
AMAP_APP_MONTHLY_LIMIT="100000"
AMAP_SEARCH_MONTHLY_LIMIT="3000"
```

JSAPI 使用 `/_AMapService` 服务端安全代理；源码目录 `%5FAMapService` 是框架对下划线路由的转义。安全密钥和 Web 服务 Key 不发送到前端。生产配置保存在 Sites 的秘密环境变量中。

## 计算规则

- 全程步行 ≤1800 秒，普通自行车 ≤1200 秒。
- 地铁组合 ≤1200 秒：小区入口到进站口的步行／骑行＋高德地铁路段耗时＋换乘步行＋出站口到工区的步行／骑行。
- 不另加首次进站、最终出站的站内步行，也不另加候车。高德地铁路段字段不是独立列车时刻表。
- 地面接驳使用地铁口坐标；地铁段的名称和复核链接使用车站坐标。换乘作为独立一段展示。
- 采用原始秒数判断，显示取整不改变结论。16 个工作日的租住要求需另行满足。

这是用户指定的分段口径。申请时应以公司要求的地图页面时长和截图复核，应用不代替公司审批。

## 数据与误差

工区、地铁线网、出口和固定路线使用高德数据；范围图在本地结合 OSM 路网按 50 米网格预计算，输出 GCJ02 坐标。直接骑行使用 120 个独立空间样本校准。范围是选房初筛估算，具体地址使用高德接口核验，无法保证穷举所有地图软件或任意换乘方案。

模型验证结果见 `public/data/validation.json`。地点未找到可行路线、查询中断和额度受限分别展示，不将未完成查询判断为不符合。

路线缓存 7 天，搜索缓存 30 天；D1 使用原子额度计数和请求间隔。达到应用预算时停止新增查询，静态范围仍可浏览。离线准备脚本也有独立调用账本；这些限制不代表整个高德账号剩余额度。

## 重新生成范围

准备 Python 环境，安装 `scripts/data/requirements.txt`；将广东 OSM PBF 放入 `work/guangdong.osm.pbf`。下载来源：https://download.geofabrik.de/asia/china/guangdong.html 。数据工作目录、原始响应、密钥和虚拟环境不进入 Git。

```sh
.venv/bin/python scripts/data/build_network.py
.venv/bin/python scripts/data/calibrate_bicycling.py
python3 scripts/data/prepare_rail_plans.py
.venv/bin/python scripts/data/validate_network.py
.venv/bin/python scripts/data/generate_coverage.py
```

地铁脚本按当前快照日期 2026-11-09 09:00 查询，支持中断续算；更新日期或计算规则时需调整版本并重新生成参考数据。生成器拒绝把未完成的地铁准备结果发布成完整覆盖图。高德请求缓存和本月离线调用账本位于 `work/`。

## 检查

```sh
npx tsc --noEmit
node --experimental-strip-types --test tests/commute.test.ts
.venv/bin/python scripts/data/test_policy.py
npm run build
```

OSM 数据：© OpenStreetMap contributors，ODbL。高德数据和链接按其服务要求使用。
