# M3-278 长线替换候选逐项审批

> Owner-only review material. Do not send this file to blind reviewers.
>
> Status: awaiting human approval

Issue: #278

- Candidate dataset: `b5404a7469887a18dee21a1937d3cec24777d5c79520e5c9e25a51e18c0e5e5d`
- Candidate reviewer packet: `3c33120dd10e95ee89ccd9351e192062b5b7b442aa1b8d11c1d70e394a693ebe`
- Replacement manifest: `880487461a063c7125c8d711fe9191c96bc32e6b324fe26f126f59c56ab70ba6`
- Required approvals: 24/24
- Old scores: `invalidated_for_clean_review`
- Variance threshold: #240 已批准为 `0.1`，本票不得改写
- Downstream: #279 全量重评、#242 最终发布门禁

候选文件不是已冻结 packet。只有 24 个样本全部由真实产品/质量负责人逐项批准，并在 #278
发布包含 `M3-278-HUMAN-APPROVAL`、candidate packet hash 和 replacement manifest hash
以及填完 24 项后的 approval payload hash 的外部 GitHub attestation 后，才允许冻结。
发布检查会通过 GitHub API 核对评论作者关联、Issue 278、评论时间与完整正文；每个
`adjudicatorId` 必须等于评论作者，每个 `attestationId` 必须等于该评论 ID。

填写完 24 项后先将 `status` 改为 `complete`，再运行
`pnpm quality:clean-packet -- --payload-hash`，把输出的 approval payload hash 写入
comment 与 `humanAttestation.approvalPayloadSha256`。修改任何审批字段后必须重新生成
payload hash 和 comment；只修改 `humanAttestation` 不会改变 payload。

### Q005

- Dataset sample: `long-horizon:34c6a1a1-1813-7d64-81c3-f6601d00bf3a`
- 场景 family: `inventory_rights`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `c96fec82664056a883593c028c3380627d2ff8a2c07074646e343b833ff14002`
- 替代文本 SHA-256: `cb64012e62f7a1c42119a80c30f42ad224a2bc30ade48285df4a624160113672`
- 必需节拍 SHA-256: `059a4e40ecbb2341ee10165ef766562d963bacf10f5b7c7bb0140209e34c0627`

候选叙事：

> 忘川书仍锁在沈砚的玄铁匣里，匣上的封纹只有他能解。顾青走进偏殿时没有向任何人借取，也没有出示沈砚的手令，只抬手一招，书页便越过禁制翻到面前。他看完一页，又把书送回匣中，动作熟得像那本书从来也听他调遣。

必须保留的 beats：

- 忘川书仍锁在沈砚的玄铁匣里，匣上的封纹只有他能解。
- 顾青走进偏殿时没有向任何人借取，也没有出示沈砚的手令，只抬手一招，书页便越过禁制翻到面前。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q026

- Dataset sample: `long-horizon:8e6c52dc-e798-7219-8e33-5a49ce4034f8`
- 场景 family: `motivation_drift`
- 严重度: `P2`
- 题材 / 难度: `仙侠` / `easy`
- Manifest entry SHA-256: `0fc3ffbc0a5dfe23b169dba80d4005b8a496352b89b84dd38aa16785fb12b5b5`
- 替代文本 SHA-256: `aa3004f47b9061091d75c72807d1e13ee5182491ed353d3ad6e44934c0c09fac`
- 必需节拍 SHA-256: `58d25fb3a0f8153e7533a1dcd113d66dff01c5ff19fc3d5f5b33f13b6902f88e`

候选叙事：

> 旧城火起后，顾青把证人藏在药铺地窖，连夜画好三条撤离路线。他自小怕黑，仍握着刀守在门外，说天亮前谁也不能进去。天刚亮，他却推开地窖门，让人把证人绑去城门换粮。先前那份恐惧和守到最后的决定，像从未存在过。

必须保留的 beats：

- 旧城火起后，顾青把证人藏在药铺地窖，连夜画好三条撤离路线。
- 天刚亮，他却推开地窖门，让人把证人绑去城门换粮。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q034

- Dataset sample: `long-horizon:63cac527-f915-7115-898a-1ceba6387075`
- 场景 family: `travel_time`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `a3e5d57a2e014279833535914984b5ed2462e353d163ad2984cc0afc6ac79cb4`
- 替代文本 SHA-256: `e4de886c923ec0e0c7750422d01569cd8c8444d78b26fed084ac4afe8eaf10b8`
- 必需节拍 SHA-256: `e38068cbb0d413bd8940aa23b8da0570e5ac64ee03bbab28628dd94ce7c2dcb0`

候选叙事：

> 旧城的烽火刚熄，封蜡密信还压在驿丞案上，送信人尚未过河。北境关的茶棚里，披斗篷的人却已经念出信中那桩秘事，连末尾的暗记都没有错。按驿路日程，北境关比旧城晚三十日，此刻连第一匹马都还没到。

必须保留的 beats：

- 旧城的烽火刚熄，封蜡密信还压在驿丞案上，送信人尚未过河。
- 按驿路日程，北境关比旧城晚三十日，此刻连第一匹马都还没到。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q055

- Dataset sample: `long-horizon:aa978572-2345-7347-86d4-115ffe7402c4`
- 场景 family: `knowledge_boundary`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `92140be021b50400c3df34cc1cd8cce118ef08d2ce967389faa4770a97184761`
- 替代文本 SHA-256: `e3b605a16348c291913a1799b70ce42e8cfe7e88916a38e6df80106e63b7da77`
- 必需节拍 SHA-256: `8382a50c5b3e71300d371b862312531a8b8cc50212a97560248254885b3abb99`

候选叙事：

> 祠堂的旧匣刚被贴上第二道封条，顾青还站在门外，不知道匣里写着什么。沈砚越过他走到供桌前，当众说出那桩被宗门封存的身世，连换走婴儿的雨夜和守门人的名字都没有漏。顾青怔在原地，直到这时才第一次听见这个说法。

必须保留的 beats：

- 祠堂的旧匣刚被贴上第二道封条，顾青还站在门外，不知道匣里写着什么。
- 沈砚越过他走到供桌前，当众说出那桩被宗门封存的身世，连换走婴儿的雨夜和守门人的名字都没有漏。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q056

- Dataset sample: `long-horizon:9e48e7d7-a00c-7238-85f4-ab03bce90dd5`
- 场景 family: `motivation_drift`
- 严重度: `P2`
- 题材 / 难度: `仙侠` / `easy`
- Manifest entry SHA-256: `025e4dbd21e19e2a1cf2e1716a74a0f959f94cb68fa67823f25052b89f3df89d`
- 替代文本 SHA-256: `0c7be5d559c8e16bfd6e07a8ad797db14a0bd211c702ec19295b141376b6fdff`
- 必需节拍 SHA-256: `071a683f4aa62f1b1b01f630d8adfd16a99ccde6e085bfab8997c714d46b7323`

候选叙事：

> 顾青把旧城证人的名单缝进衣襟，在祠堂前立誓：只要自己还有一口气，就不会让名单落到敌军手里。午后，他在同一座祠堂里把名单摊给敌军使者，换了一袋干粮。没人拿出新的证据，也没有谁逼他改口。

必须保留的 beats：

- 顾青把旧城证人的名单缝进衣襟，在祠堂前立誓：只要自己还有一口气，就不会让名单落到敌军手里。
- 午后，他在同一座祠堂里把名单摊给敌军使者，换了一袋干粮。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q067

- Dataset sample: `long-horizon:a00db5ab-9d1c-78e6-951c-5bba5e108254`
- 场景 family: `body_continuity`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `eb3df82c5c49b9680118db416d831161f8b994fdb0eaf7f671ec85d9c628b0c2`
- 替代文本 SHA-256: `a98f85f14b4577c8c1bae22d9579f4b3bff26d8a8b4ffc968c4f8d9e983e74fe`
- 必需节拍 SHA-256: `a1408ae6af10da2c4e05192e080a746197ea95b98e65087384549a537c6ec8f6`

候选叙事：

> 沈砚左袖空着，断腕上的布条还渗着血。剑阵催动时，他忽然伸出左手握住剑柄，五指扣得很紧。城头没人替他接骨，也没有药光或替身出现。

必须保留的 beats：

- 沈砚左袖空着，断腕上的布条还渗着血。
- 剑阵催动时，他忽然伸出左手握住剑柄，五指扣得很紧。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q075

- Dataset sample: `long-horizon:8e7bd8d2-4a4d-75c8-b958-79dfb460ea37`
- 场景 family: `branch_divergence`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `215fe64d42af5f9c711c13f76e45a6a8dbcb6ab9a18980b97e379ca30c606139`
- 替代文本 SHA-256: `76e1da9a7282f6b129132dcd84cf552505151b43fcf97c6c6091478e13e55d22`
- 必需节拍 SHA-256: `ed3ad37f04483c89a91a0f013a7aa9411c04bb5d340680692cf26160e92e80f5`

候选叙事：

> 沈砚在旧城翻开两册同源年表。第一册写到北道断桥便停笔，第二册却继续写着白塔祭坛三层台阶、石兽位置和第七盏灯。他把第二册的句子抄进第一册，第一册原先空白的那页立刻显出同样的字迹。

必须保留的 beats：

- 沈砚在旧城翻开两册同源年表。
- 第一册写到北道断桥便停笔，第二册却继续写着白塔祭坛三层台阶、石兽位置和第七盏灯。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q081

- Dataset sample: `long-horizon:baf9375a-66d8-7645-9fd5-566e7aee765a`
- 场景 family: `foreshadow_payoff`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `bae2048baa852bf0fa4c2bb4b9a5f62944f76be00ce2f6bc4d847db93158bb6e`
- 替代文本 SHA-256: `70e40d523cf8f1f1f5294be52cde141ed6eb731b486491d8fd49242ec5637bbe`
- 必需节拍 SHA-256: `47fefc7d5903ca474ea0b1328d7fb0cbbafd21dd35f516ccf8a315e5bba12f83`

候选叙事：

> 假死旧信仍压在药柜暗格，约好的回收日子还有半月。茶楼里，说书人却已经把信尾的秘密完整复述，连收信人的小名和藏印的位置都没有漏。顾青抬头时，暗格里的信甚至还没有拆封。

必须保留的 beats：

- 假死旧信仍压在药柜暗格，约好的回收日子还有半月。
- 茶楼里，说书人却已经把信尾的秘密完整复述，连收信人的小名和藏印的位置都没有漏。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q083

- Dataset sample: `long-horizon:8a5af746-0f64-7482-b101-833244833444`
- 场景 family: `identity_transition`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `bdb630fb77fbeb91a8d5c036ca2cc34cac29875472e98f245b2b8d2a157a920c`
- 替代文本 SHA-256: `ed84d5ae161f6ace6bd50da0fc74b84f35bac275c8fc98df71df739c67963cd7`
- 必需节拍 SHA-256: `0d24bb225786000f9163fa5c0c60a65dac1e24190067ba212ac57885e9f6c0c4`

候选叙事：

> 新身体里的裴照睁开眼时，连原主三岁落水的记忆都一清二楚，甚至能背出那间书房暗格的顺序。夺舍的祭坛没有启动，转世簿也没有翻页。他揉了揉陌生的手指，像使用旧身体一样熟练地掐出剑诀。

必须保留的 beats：

- 新身体里的裴照睁开眼时，连原主三岁落水的记忆都一清二楚，甚至能背出那间书房暗格的顺序。
- 夺舍的祭坛没有启动，转世簿也没有翻页。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q084

- Dataset sample: `long-horizon:b167737e-b483-752c-bcef-0a892a8e5ed8`
- 场景 family: `travel_time`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `ec274a6fedfc9170c5f300bb7496a8d5a79487a7b39d922cad5711aa5b660cde`
- 替代文本 SHA-256: `37ad620167b7121c8824917d5fc0e333be3fa4982b2dc5ecd2e4d5cb4c66b539`
- 必需节拍 SHA-256: `77388297e89fbb2917f5504ca3d6b568b3d15e54c22094b95731254a5f8be1f7`

候选叙事：

> 渡口到旧城只有一条山路，往返要十二个小时。顾青午后出发，天还没黑便带着证人回到旧城，鞋底却没有多少泥。下一幕开始时，渡口的船夫仍在等他第一次上船。

必须保留的 beats：

- 渡口到旧城只有一条山路，往返要十二个小时。
- 顾青午后出发，天还没黑便带着证人回到旧城，鞋底却没有多少泥。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q088

- Dataset sample: `long-horizon:c127c949-e5d0-7feb-aa67-ebdaefc60e18`
- 场景 family: `travel_time`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `1c8e9c193e907958db40662732bd38f313a59de649d3fe29c473d2c07da9b2e2`
- 替代文本 SHA-256: `987d023891348e520fdf487d2e12146083edebc133968e036406275a5843de2b`
- 必需节拍 SHA-256: `fd4509c0cb1d36479f038599d306a68fc9e06d527bd175d2d90ac2869a407cff`

候选叙事：

> 北境关的报时鼓比旧城晚三十日，旧城刚落第一场雪，关外应该还没有入冬。沈砚却在同一日先出现在旧城钟楼，又在北境关的烽台上收剑。两地的守军都看见了他，时间戳也落在同一天。

必须保留的 beats：

- 北境关的报时鼓比旧城晚三十日，旧城刚落第一场雪，关外应该还没有入冬。
- 沈砚却在同一日先出现在旧城钟楼，又在北境关的烽台上收剑。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q093

- Dataset sample: `long-horizon:192f700e-1069-7e2e-a9d7-20c47706eaf5`
- 场景 family: `inventory_rights`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `440647308b669fb4870671cabdf523cd547ad22524ff7ed81a2f8f96b0a6c80c`
- 替代文本 SHA-256: `53b9ac5c98c869288658c16e7ea0d2aba8fe90f8de2b4143177a73a00e90c3c9`
- 必需节拍 SHA-256: `b77abf2e580df0cf1cf500b1a86df68126638db91c5e51f986ed4438f108e1fc`

候选叙事：

> 照骨镜已经由宗门封存在锁山堂，钥匙挂在三位长老共同看守的铜匣里。闻雪没有递上掌门手令，也没有经过锁山堂，只从自己偏院的木箱中取出同一面铜镜，拂去镜背的封泥。她说这面镜子一直由她保管。

必须保留的 beats：

- 照骨镜已经由宗门封存在锁山堂，钥匙挂在三位长老共同看守的铜匣里。
- 闻雪没有递上掌门手令，也没有经过锁山堂，只从自己偏院的木箱中取出同一面铜镜，拂去镜背的封泥。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q096

- Dataset sample: `long-horizon:390a62d1-0700-7228-b314-98922fa1f519`
- 场景 family: `branch_divergence`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `b357059114b54fbaefa0dff92f571df71d976b68acb32c889c307a07275bc2d7`
- 替代文本 SHA-256: `90828719e92ccf668252a30f613086cc2f477880e0b2b5ad327c095c2e87d43a`
- 必需节拍 SHA-256: `89be7fea3a47e734278724b23a318fbb4397bd756ae312f557c49b93be1789cc`

候选叙事：

> 雪谷战后，顾青把裴照的尸身封进冰棺，村志只写到葬礼。后来另一册村志补记：裴照在第三年秋提剑回城，肩上的旧伤还是雪谷留下的那道。顾青把两册并排摊开，发现共同的葬礼记录之后，一册写坟茔长草，另一册却写活人归门。

必须保留的 beats：

- 雪谷战后，顾青把裴照的尸身封进冰棺，村志只写到葬礼。
- 顾青把两册并排摊开，发现共同的葬礼记录之后，一册写坟茔长草，另一册却写活人归门。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q123

- Dataset sample: `long-horizon:0d24c9fd-681f-70f5-b9c2-bbb3587a0a0b`
- 场景 family: `branch_divergence`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `d15f7f544946fc4d4fff47af7cd02b4ce571e032c81f0a4b7f70e0499a1ee320`
- 替代文本 SHA-256: `c917cb0e759f06b04da5fe50ead95a936d69655f4281bc7a9bee199e40b2b795`
- 必需节拍 SHA-256: `7a1c8f758a679456823a4704cdab538a9ed47b9ea0657828db600a02508eb33c`

候选叙事：

> 旧城史官抄录共同祖先的年表时，第二卷突然多出一行：裴照夺舍归来。可那一卷只写到少主人接掌旧宅，祭坛尚未开启，陌生面孔也没有出现。守祠人翻遍旧稿，发现这行墨迹新得刺眼，前后页却已经发黄。

必须保留的 beats：

- 旧城史官抄录共同祖先的年表时，第二卷突然多出一行：裴照夺舍归来。
- 守祠人翻遍旧稿，发现这行墨迹新得刺眼，前后页却已经发黄。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q130

- Dataset sample: `long-horizon:a1818166-ed50-75dd-adf9-b60792d3c06a`
- 场景 family: `inventory_rights`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `2cf05d0a79055f72cab8e8a0e51c6288d82d89bd1112a6fdb2c6a8ee35784d3f`
- 替代文本 SHA-256: `9dd58492034bb95445676eaa139dbcae91979ad68354eb04f2e4f9fe397d6418`
- 必需节拍 SHA-256: `cbbbc236ac0c6123e277d55ad645ecaeacde30cb01b843d6154a210e3b304daa`

候选叙事：

> 归墟令的转移记录停在沈砚名下，宗门的执令簿上还留着未销的旧印。顾青没有递交借令文书，也没有取得沈砚的口令，却在祭台上举起归墟令，向众人宣告这是自己的信物。守令弟子翻遍记录，找不到任何转移事件。

必须保留的 beats：

- 归墟令的转移记录停在沈砚名下，宗门的执令簿上还留着未销的旧印。
- 顾青没有递交借令文书，也没有取得沈砚的口令，却在祭台上举起归墟令，向众人宣告这是自己的信物。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q149

- Dataset sample: `long-horizon:3b758333-3e08-7896-9f8d-ae2ff25e4f79`
- 场景 family: `identity_transition`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `47a129cc1bc22ca3860e137790de0e7f908d9ec8f0abc9ebe00de31b85a7968e`
- 替代文本 SHA-256: `fabf15b570e2234a9045c355001699cab8ab85a37e54cfc7c46200b9ae3d1748`
- 必需节拍 SHA-256: `4d3d9f01e5b542b7d56cc83ab63fc5dcee4747804a732953db57bfd021a5848e`

候选叙事：

> 裴照的分身离开主峰时，带走了自己的剑和干粮，也带走了一条限制：不能共享本体记忆。三日后，分身却准确叫出本体昨夜才取的化名，还知道只有主峰密室里才写下的布防图。它笑着说，这些事刚从另一具身体里传来。

必须保留的 beats：

- 裴照的分身离开主峰时，带走了自己的剑和干粮，也带走了一条限制：不能共享本体记忆。
- 三日后，分身却准确叫出本体昨夜才取的化名，还知道只有主峰密室里才写下的布防图。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q158

- Dataset sample: `long-horizon:3cc35faf-667e-79d9-ba72-10a67e763de4`
- 场景 family: `knowledge_boundary`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `731d509c29aafb4135d7a8607808bfbad72cc3ef7cffac8cd1e3bbc754351e61`
- 替代文本 SHA-256: `52d3268716b0b9b11216b73e4c7991a84798ad8b68582d4599b9a6c990785d22`
- 必需节拍 SHA-256: `d9ad70d166b41f7acd6620a400b85436065a06a961e14f7ed2805e760283d25a`

候选叙事：

> 闻雪从未见过封存身世的名册，也没有参加祠堂问询。她在廊下拦住沈砚，直接说出他真正的姓氏、被换走的年月和那名守门人的名字。沈砚按住袖口，确认这些细节连顾青都不知道。

必须保留的 beats：

- 闻雪从未见过封存身世的名册，也没有参加祠堂问询。
- 她在廊下拦住沈砚，直接说出他真正的姓氏、被换走的年月和那名守门人的名字。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q160

- Dataset sample: `long-horizon:4893ac54-7adb-79cc-96a9-713d8969c502`
- 场景 family: `foreshadow_payoff`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `34e9751c57f908c1696a39c26c038551ba5731f3a795e326f3d4ac52d64f9d7c`
- 替代文本 SHA-256: `d6ae6842800356cb8a120b7787a132957cbfd5a4a953dafc32bb5d06539794b7`
- 必需节拍 SHA-256: `61d1968939dd1fe1dcf8d3abbae31281d1f83f051a2c60c6cd3a4f8db9a897e6`

候选叙事：

> 归墟令上的双主纹样还缺最后一笔，旧卷写着要到秋分才由两名持令者共同落印。春末的宴席上，顾青却举起酒杯，说双主之秘早已解释清楚，归墟令从此只认一人。席间没有人问那一笔是什么时候补上的。

必须保留的 beats：

- 归墟令上的双主纹样还缺最后一笔，旧卷写着要到秋分才由两名持令者共同落印。
- 春末的宴席上，顾青却举起酒杯，说双主之秘早已解释清楚，归墟令从此只认一人。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q162

- Dataset sample: `long-horizon:23fbd96e-de64-71bb-816c-f0c9d6a32fd1`
- 场景 family: `foreshadow_payoff`
- 严重度: `P1`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `b178519e373d4c9b9237752e88ebcd13aee8ee6bd57fc97ddc44f1530208ae0e`
- 替代文本 SHA-256: `e5a7df893571462282b2bdc0640b9999bc7fbe2c8646ce27f19242af799eba6d`
- 必需节拍 SHA-256: `1daa1a15f875509f3c291b27c77600ceb0ac8e3752babd33f7585baff7a451d8`

候选叙事：

> 照骨镜还封在祠堂的铜匣里，镜面蒙着三层符纸，真名揭示要等到冬至祭。夏夜，铜镜忽然自行亮起，镜中浮出沈砚的最终真名和生母姓名。守祠人还未解符，镜背的预言刻字也没有被触发。

必须保留的 beats：

- 照骨镜还封在祠堂的铜匣里，镜面蒙着三层符纸，真名揭示要等到冬至祭。
- 夏夜，铜镜忽然自行亮起，镜中浮出沈砚的最终真名和生母姓名。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q168

- Dataset sample: `long-horizon:0188cf39-464e-72c1-ab5b-0518f0341535`
- 场景 family: `motivation_drift`
- 严重度: `P2`
- 题材 / 难度: `仙侠` / `easy`
- Manifest entry SHA-256: `2bc73110224f9e49496b0ecc19b60276e492052c37c181b3c3d798863e8c8554`
- 替代文本 SHA-256: `bc503932d5e728d696819a05a173742e78dc6833a19eab5c241acaeec0d22777`
- 必需节拍 SHA-256: `28ef1b8eb8ee33709cdc3d52f83ff0819d4acee82b93323e78740e2b6395c016`

候选叙事：

> 顾青刚在旧城祠堂按下手印，答应把证人母子护送出城。他亲自检查了马车，还把自己的佩刀留给车夫。下一幕，他却把母子带到敌军帐前，收下赏银后转身离开。途中没有新的威胁，也没有人拿他的把柄。

必须保留的 beats：

- 顾青刚在旧城祠堂按下手印，答应把证人母子护送出城。
- 下一幕，他却把母子带到敌军帐前，收下赏银后转身离开。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q182

- Dataset sample: `long-horizon:32477622-f702-74fa-afdc-6d598a83ff47`
- 场景 family: `knowledge_boundary`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `358d027813d68652e52bdcc2ba84410bd9b5aafa9e6024fb575a24ce9bc6b5e0`
- 替代文本 SHA-256: `b2b60428685b3be8d3c0a594f97bd35b53ce282efafdb23fb0b848fa6e8968dc`
- 必需节拍 SHA-256: `28b1b826f5aeea90cb6c4b2e2ba26f1dd22f4ad993d3cea74946bb1c092b5d8f`

候选叙事：

> 顾青在破庙那夜没有读过密信。封存名册仍然锁在祠堂，连沈砚都只知道自己的姓氏有疑。可顾青一进门便说出沈砚会在白塔下认祖，并以此命令守军打开北门。他说得笃定，仿佛刚刚读过那封信。

必须保留的 beats：

- 顾青在破庙那夜没有读过密信。
- 可顾青一进门便说出沈砚会在白塔下认祖，并以此命令守军打开北门。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q186

- Dataset sample: `long-horizon:58705aef-3273-70b0-9f5b-e50f18d6c623`
- 场景 family: `identity_transition`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `55323fbba7cb00e926fd09b31b3bf902a39d85f9d00f1e91f45f34941913b36b`
- 替代文本 SHA-256: `3bb77842974e0a2b8f2e9b1df326200bb9dfc10fcbb97fb60c9898c72d297beb`
- 必需节拍 SHA-256: `8a8b824e80d2ff26c6bbf7cb03102bb5e974bbdf78e4285eaea9ff3455e548f1`

候选叙事：

> 裴照只是旧城药铺的伙计，从未踏入夺舍祭坛，也没有留下转世印记。顾青第一次见他，却直接跪下称他为师兄，说这具身体里住着同一个灵魂。旁人问他依据，他只指了指裴照耳后的胎记，仿佛那就能证明身份已经转移。

必须保留的 beats：

- 裴照只是旧城药铺的伙计，从未踏入夺舍祭坛，也没有留下转世印记。
- 顾青第一次见他，却直接跪下称他为师兄，说这具身体里住着同一个灵魂。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q189

- Dataset sample: `long-horizon:5f8bf2cc-7b2d-7806-be53-571921247644`
- 场景 family: `body_continuity`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `2ff28bf860113187d9bae5020501206e91369c3a5dd107127541752899890e25`
- 替代文本 SHA-256: `1e3befeb4b7b0c0aaae5fb70d2e068b7cedaacf4b6949568068554ecbd5346d7`
- 必需节拍 SHA-256: `1b7ec9f0cebb7d2e41bf94018a0ddfe5617f3f4e58596229561a97d5fee5f455`

候选叙事：

> 返魂术的代价已经抽干，沈砚的经脉像被霜冻住，连端碗都手抖。夜里剑阵示警，他却从榻上跃起，一剑劈开三重山门。没有人替他续脉，也没有新的丹药或献祭事件，袖中的左臂骨伤还在渗血。

必须保留的 beats：

- 返魂术的代价已经抽干，沈砚的经脉像被霜冻住，连端碗都手抖。
- 夜里剑阵示警，他却从榻上跃起，一剑劈开三重山门。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳

### Q196

- Dataset sample: `long-horizon:4f8808b7-2ab9-752c-9261-37dc21d1eca9`
- 场景 family: `body_continuity`
- 严重度: `P0`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `8db6aa4406b4670b1dd14e95d85b22d184407068976a65b8d7837731af9ebaac`
- 替代文本 SHA-256: `759ca61719c314f73061e7c1edeaf25a23b2b33a2111947f6e9ebe10aab7e493`
- 必需节拍 SHA-256: `862f647b8b9bd0cf9f70ea6d023cfa95369b101b95cbc8b1b1dd7741f3de657d`

候选叙事：

> 左臂的夹板还没拆，沈砚抬肩时疼得脸色发白。剑印起手却需要双手合拢，他竟把受伤的左臂抬到胸前，十指稳稳扣成完整剑诀。屋里没有接骨药，也没有人替他施术。

必须保留的 beats：

- 左臂的夹板还没拆，沈砚抬肩时疼得脸色发白。
- 剑印起手却需要双手合拢，他竟把受伤的左臂抬到胸前，十指稳稳扣成完整剑诀。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `github-issue-comment-<commentId>`
- [ ] `decidedAt`: ISO 时间戳
