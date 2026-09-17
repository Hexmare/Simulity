# Shipped content

Every row in this tree carries a **pinned UUIDv4 primary id** (`id` field).
Slugs are authoring-only metadata — never stored or compared at runtime.
Runtime references (job `workplace`, goal `treeId`, consideration `needId`,
trait-modifier keys, kit `buildings`/`homes`/`roster`/`defaultPcJobId`) hold
UUIDs or `sys:*` tokens. Renaming a slug requires zero code changes.

Layout (see `docs/Data_Driven_Catalog.md` §4):

```
content/
  catalog/  needs.json traits.json commodities.json building-kinds.json
            jobs.json ancestries.json spells.json goals.json social.json
            names.json setting.json
  kits/     fenwick-ward.json
  trees/    eat sleep drink ward work socialize hygiene relax worship wander (.json)
```

The loader (`src/sim/defs.ts`) imports every file statically and exposes
byId / bySlug / tagged indexes. Merge order: shipped catalog → active kit →
town overlay (later wins on the same UUID; deletion only via explicit
`removedIds`).

## Pinned generated ids

Ids for collections without doc-pinned UUIDs (kinds/jobs/commodities/needs/spells
keep their `docs/Urban_Fantasy_Default_World.md` §2 UUIDs). Generated 2026-09.

| collection | slug | id |
| --- | --- | --- |
| ancestries | human | 221f7852-5394-4584-a0dc-7a5c5eb94775 |
| ancestries | demon | 7f56be7f-d97c-4e7b-b66c-a423bd9c1e9a |
| ancestries | angel | b317cccb-aad9-46b3-93d6-6376dd2399df |
| ancestries | vampire | 05f5f006-08d8-4fc2-918b-2e264d72f01d |
| traits | gregarious | 51e6053a-1d42-4793-a8d9-b6f62e07c128 |
| traits | loner | 47639f18-b99c-423a-92ac-3ffecddb58d3 |
| traits | glutton | c4fb88f9-e36b-4b98-924f-2d498ebe13f0 |
| traits | industrious | 3259591e-14fb-4c7e-9568-6eeaf8bfa905 |
| traits | kind | f9df6553-9364-4956-b497-66616b73115d |
| traits | irritable | 49578c30-7423-41e9-a2b8-3545297f8126 |
| traits | romantic | d01e70be-7c02-4ce0-b290-cae01f8dd42a |
| traits | devout | b44156b8-1893-4859-8cf7-0e6ed1b3df69 |
| traits | lazy | 77292100-c1a0-4779-8123-aac1902a230a |
| traits | cheerful | 47c3a719-81e0-42ec-823d-41fa6a804aa0 |
| goals | eat | d079f946-4902-4d5d-81d7-d423937df963 |
| goals | sleep | ae594b26-47d3-432e-b88c-5f4eb312ce46 |
| goals | drink | 5dae3815-cff4-436d-a2e4-3b083ff60fe7 |
| goals | ward | bf30ec48-ef3c-4c0e-b73c-eedd786b5951 |
| goals | work | 01db49d7-08ee-473c-8ef3-58ac0d2c57fb |
| goals | socialize | 6ff5bf3b-3f81-4cf9-b1aa-80c1797c42e9 |
| goals | hygiene | 6f48828e-bdaa-452b-a96f-d3511c4aed51 |
| goals | relax | 95eec5eb-7a61-41f3-9735-b67e5dc24ead |
| goals | worship | c6e73d30-6634-4427-aa65-a232e1e84029 |
| goals | wander | b95f39a9-8a60-403c-9f05-f1aed24990f6 |
| trees | eat | 2c2c3a02-5358-4135-bd74-5eb5a74d418e |
| trees | sleep | da39e322-71d0-4a78-a578-c08e972db085 |
| trees | drink | 18a6771f-b879-45c1-a52e-31f2cc00b879 |
| trees | ward | 2e3dea4b-8461-41d5-924f-40fb7e27c62e |
| trees | work | cc1c85b7-316e-4a53-843f-7eed969d8f7c |
| trees | socialize | cb2cbc36-8dce-4b39-92ca-42c3d52b9e54 |
| trees | hygiene | d3cbdf8c-b960-4bb9-8057-b4481d0c2010 |
| trees | relax | 873ec15d-a8e1-42e2-a06c-b796871d5902 |
| trees | worship | cec858c6-d81c-40da-bdff-9ad9541964ea |
| trees | wander | ad84cd85-7831-4c5f-b557-728a74e79100 |
| social | greet | ff8a90bf-b600-4814-915f-c114bea6e627 |
| social | chat | 3c0637bc-0916-41c1-b1d9-62f427ef090f |
| social | joke | 90ea39cc-7845-406f-862c-f8f2ecc29bd4 |
| social | insult | 6a622e78-bb58-493a-90ca-f6fd59724c66 |
| social | comfort | 8885cb76-e4bf-4c1c-84e6-6d52656ed55d |
| social | flirt | 60fc1ce1-acff-404f-970e-9c5e0b79074f |
| social | vow | 5e9636e2-5c56-4824-8af5-3130fc8ac2d0 |
| social | ask | 90b497b7-c23f-4829-8f19-08af372625c2 |
| social | feed | 91ee13ae-a9e8-4e79-a1de-65d80630ff9a |
| social | part | 40b22e13-85b7-4589-9e48-18730a459e2b |
| social | argue | 0a8875ba-b10f-4259-9f03-e3ebcbb1cf10 |
| social | praise | 86a0fc6d-eb64-4410-ab38-184582cad0d9 |
| kits | fenwick-ward | f3899133-abe8-490a-a1ab-57da0ecba1cf |
| setting | fenwick-ward-setting | ef88cf98-6713-4410-86bd-fda4de824b19 |

Doc-pinned ids (do not regenerate): `docs/Urban_Fantasy_Default_World.md` §2 —
kinds, jobs, commodities, needs, spells.
