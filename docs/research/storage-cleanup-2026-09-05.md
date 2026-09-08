# E: storage cleanup audit — 2026-09-05

This is a read-only cleanup manifest for Alystria / AI Video Tutorial Generator artifacts under `E:\temp`. It does not contain an executable deletion script.

No files were deleted by the agent's terminal commands. Four deletion attempts were rejected by automatic approval review. The first used the complete reviewed target list; the second was a single exact literal directory after resolved-path equality verification; the third retried the same reviewed PowerShell mechanism after renewed user authorization. After the reversible move, a fourth attempt targeted only the exact quarantine root under a changed full-permission context, after revalidating all 20 entries, containment, link absence, and process absence. The exact terminal reason from the reviewer remained: `rejected: blocked by policy`.

Afterward, the user requested a safer reversible action. Twenty confirmed obsolete/re-creatable folders totaling 98,344,871,506 bytes were moved on the same volume into `E:\temp\AI Video Tutorial Generator Cleanup Review 2026-09-05`, preserving their original relative layout. The pre-move and completed verification record was `MOVE-MANIFEST.md` inside that review folder. Every original source was verified absent and every destination verified present. The move itself reclaimed no disk space. The user later deleted the quarantine manually; its absence was verified. At that verification, `E:` had 290,753,171,456 bytes (270.78 GiB) free. Concurrent builds and model activity prevent attributing the change in free space to the quarantine with byte-for-byte precision, but the entire reviewed quarantine is gone.

Free space was 186,746,843,136 bytes at the start of the audit and 178,346,360,832 bytes at the final recorded check. The decrease happened while active builds and model downloads were running; this cleanup reclaimed zero bytes.

## Verified obsolete cache and scratch data

All paths below resolve beneath the explicit project-owned root `E:\temp\Alystria Studio`. No active process referenced the root during the check. The newest files in the large build/cache folders were written on September 1 or 2, 2026. Current packaging uses the separate trusted runtime and `*-current` build paths listed under retained paths.

| Exact path | Bytes | Files | Classification |
| --- | ---: | ---: | --- |
| `E:\temp\Alystria Studio\__pycache__` | 12,198 | 2 | Python bytecode cache |
| `E:\temp\Alystria Studio\build` | 8,286,672,805 | 8,854 | Superseded build output and dependency cache |
| `E:\temp\Alystria Studio\build-temp` | 10,241,884 | 367 | Superseded build scratch |
| `E:\temp\Alystria Studio\cache` | 2,678,857,089 | 3,666 | Superseded package/build cache |
| `E:\temp\Alystria Studio\evaluation-temp` | 0 | 0 | Empty evaluation scratch |
| `E:\temp\Alystria Studio\logs` | 1,115,732 | 954 | Old staging logs |
| `E:\temp\Alystria Studio\package-temp` | 3,711,172 | 5 | Old packaging scratch |
| `E:\temp\Alystria Studio\pip-cache` | 1,085,406,499 | 355 | Re-creatable pip cache |
| `E:\temp\Alystria Studio\render-temp` | 0 | 0 | Empty render scratch |
| `E:\temp\Alystria Studio\Temp` | 14,849,703 | 50 | Old general scratch |
| `E:\temp\Alystria Studio\test-temp` | 1,835,525 | 5 | Old test scratch |
| `E:\temp\Alystria Studio\tmp` | 0 | 1 | Empty scratch |
| `E:\temp\Alystria Studio\uv-cache` | 18,078,940 | 3,632 | Re-creatable uv cache |
| **Total** | **12,100,781,547** | **17,891** | **Eligible once deletion is permitted** |

## Large future candidates

These paths were inventoried but deliberately retained during the active handoff.

| Exact path | Bytes | Files | Condition before removal |
| --- | ---: | ---: | --- |
| `E:\temp\AI Video Tutorial Generator\runtimes\WanGP` | 34,223,322,235 | 2,990 | Presenter audit confirmed this rejected LongCat runtime is unused by the selected LivePortrait-to-MuseTalk route. Its 1.96-second result is preserved in documentation/evidence. Remove only after the active handoff review. |
| `E:\temp\AI Video Tutorial Generator\build\cargo-windows-audit` | 6,663,343,626 | 5,918 | Remove only after `cargo-current` builds and tests successfully. |
| `E:\temp\AI Video Tutorial Generator\runtimes\HunyuanVideo-Avatar` | 185,653,486 | 137 | Source-only audit clone; remove after the active research handoff is complete. |
| `E:\temp\AI Video Tutorial Generator\runtimes\EchoMimicV3` | 154,152,419 | 273 | Source-only audit clone; remove after the active research handoff is complete. |
| `E:\temp\AI Video Tutorial Generator\runtimes\InfiniteTalk` | 47,612,684 | 101 | Source-only audit clone; remove after the active research handoff is complete. |
| **Total** | **41,274,084,450** | **9,419** | **Conditional candidates** |

The first reviewed obsolete and conditional groups account for 53,374,865,997 bytes. This number is an inventory total, not reclaimed space.

## Expanded safe-delete set inside this project

The presenter and Windows-runtime owners confirmed the following additional paths are unused by the selected runtime or superseded by the current build. Together with the 12,100,781,547-byte Alystria Studio cache group and 34,223,322,235-byte WanGP runtime above, these exact paths formed a 91,681,527,880-byte (85.39 GiB) safe-delete set. They are now in the reversible cleanup-review folder. The separately confirmed 6,663,343,626-byte `cargo-windows-audit` target was moved with them after the current `cargo-current` suite passed 56 of 56 tests.

| Exact path | Bytes | Reason it is safe to remove |
| --- | ---: | --- |
| `E:\temp\AI Video Tutorial Generator\models\echomimicv3-flash` | 25,063,080,685 | Rejected research model; the selected presenter uses the separate LivePortrait-to-MuseTalk installation in the current test sandbox. |
| `E:\temp\AI Video Tutorial Generator\venvs\echomimicv3` | 5,765,728,311 | Environment used only by the rejected EchoMimic research route. |
| `E:\temp\AI Video Tutorial Generator\venvs\wangp-py312` | 6,510,998,413 | Environment used only by the rejected LongCat/WanGP route. |
| `E:\temp\AI Video Tutorial Generator\pip-cache` | 3,018,220,901 | Re-creatable old research package cache. The active image lab has its own isolated cache. |
| `E:\temp\AI Video Tutorial Generator\build-cache\desktop-tauri-target` | 4,999,395,788 | Superseded desktop target; the current application compiled from `build\cargo-current`. |

## Folder-by-folder Alystria ownership

| Folder | Bytes | Decision | Reason |
| --- | ---: | --- | --- |
| `E:\temp\AI Video Tutorial Generator` | 93,831,046,514 | Mixed: keep root, remove only exact safe paths above | Contains current builds/evidence alongside rejected research models, environments, and caches. |
| `E:\temp\AI Video Tutorial Generator Test Sandbox` | 16,721,684,813 | Keep | Current portable app, Node runtime, presenter models/configuration, projects, exports, and native-test target. |
| `E:\temp\AI Video Tutorial Generator Visual Acceptance` | 2,686,206 | Delete candidate after handoff | September 3 screenshots superseded by September 5 visual evidence; small and harmless to retain until final review. |
| `E:\temp\Alystria GPU Smoke 2026-09-02-99d3be70-inputs` | 64,078 | Delete candidate after handoff | Orphaned old smoke-test input. |
| `E:\temp\Alystria GPU Smoke 2026-09-02-e0d68e47` | 95,547,998 | Delete candidate after handoff | Old presenter smoke evidence superseded by the September 5 benchmark. |
| `E:\temp\Alystria GPU Smoke 2026-09-02-e0d68e47-inputs` | 64,078 | Delete candidate after handoff | Duplicate old smoke-test input. |
| `E:\temp\Alystria Local Image Lab` | 15,607,567,124 | Keep | Active ComfyUI environment, in-progress downloads, checkpoints, LoRAs, caches, and current evidence. |
| `E:\temp\Alystria Presenter Inputs` | 249,472 | Keep | Preserved presenter source portrait; too small to justify risking provenance loss. |
| `E:\temp\Alystria Source Assets` | 61,339,476 | Keep | Preserved template and source-image masters. |
| `E:\temp\Alystria Studio` | 18,010,493,769 | Mixed: remove the exact 12.10 GB cache/scratch group | Remaining content includes older evidence, canonical specimens, and runtime sources that were not declared obsolete. |
| `E:\temp\Alystria Studio 2.0 Test Sandbox Final` | 806,454,590 | Keep | Trusted packaging runtime source; its `Runtime\node\node.exe` was actively serving the current UI during this audit. |
| `E:\temp\Alystria Studio Test Area` | 32,580,589 | Delete candidate after handoff | Old standalone staging app from August 29 / September 1, superseded by later sandboxes. |
| `E:\temp\Alystria Test Sandbox` | 795,691,965 | Delete candidate after handoff | September 2 packaged sandbox superseded by the current AI Video Tutorial Generator sandbox. |
| `E:\temp\Alystria Visual Acceptance` | 5,213,223 | Delete candidate after handoff | September 2 screenshots superseded by current evidence. |
| `E:\temp\alystria-aligner-runtime` | 118,035,619 | Keep | Current forced-alignment runtime created and used during this handoff. |
| `E:\temp\alystria-editor-export-smoke` | 226,524 | Keep through handoff | Current native editor export evidence. |
| `E:\temp\alystria-editor-keyframe-smoke` | 15,791 | Keep through handoff | Current keyframe-render evidence. |

## `IPNbuild` and `IPNsrc`

| Folder | Bytes | Decision | Ownership evidence |
| --- | ---: | --- | --- |
| `E:\temp\IPNbuild` | 23,164,303,640 | Keep | Separate Interactive LLM / NPC project checkout on `feat/2.0-overhaul`; 229 tracked files were modified and a PowerShell process referenced it during the audit. Its origin points to `C:\Users\akshi\Desktop\Code Palace\interactive llm\Interactive-LLM-Powered-NPCs`. |
| `E:\temp\IPNsrc` | Junction; target scan reported 2,138,564,419 | Keep | Junction to the Interactive LLM repository on `C:`. The reported file bytes belong to the junction target rather than consuming that amount again on `E:`. Removing the link offers negligible space and could disrupt the other project. |

## Convai folders

These six roots total 4,767,523,462 bytes (4.44 GiB). They are not disposable remnants of this tutorial audit. The base clones anchor linked worktrees, two worktrees contain tracked changes, and the branches describe active browser-avatar and infrastructure work. No Convai path is in the safe-delete set or quarantine.

| Folder | Bytes | Decision | Ownership evidence |
| --- | ---: | --- | --- |
| `E:\temp\convai-avatar-research` | 837,661,987 | Keep | Contains three Convai Git repositories. Two serve as the Git bases for linked worktrees below; deleting the bases would break those worktrees. |
| `E:\temp\convai-avatar-worktrees` | 2,406,164,770 | Keep | Active branches `feature/browser-avatar-manifest-v1`, `feature/browser-avatar-three-package`, and `devslot/dev21-playground-secret-access`; the first two have tracked modifications. |
| `E:\temp\convai-character-apis-avatar-venv` | 242,013,409 | Keep / owning-project review | Python environment associated with the Convai character API work. |
| `E:\temp\convai-character-test-venv` | 242,160,055 | Keep / owning-project review | Separate Convai test environment. |
| `E:\temp\convai-playground-pnpm-store` | 1,028,533,476 | Keep / owning-project review | Package store associated with the Convai playground work. |
| `E:\temp\convai-playground-portrait-qa` | 10,989,765 | Keep through owning-project review | Portrait QA originals and final browser evidence. |

The contents break down as follows:

- `convai-avatar-research\convai-web-sdk_internal` is an 823,654,299-byte source clone and Git worktree base. Its main space users are the checked-in/examples tree (482,026,868 bytes) and Git object/worktree metadata (340,377,162 bytes); its `src` tree is 626,161 bytes. It anchors `web-sdk-avatar-three`.
- `convai-avatar-research\convai-character-apis` is a 7,493,041-byte Python/API source clone with `app`, Alembic, deployment, documentation, test, and tool directories. It anchors `character-api-manifest-v1`.
- `convai-avatar-research\gcp-app-infra-iac` is a 6,514,647-byte infrastructure source clone containing application Terraform/configuration, documentation, rollout, and evidence trees.
- `convai-avatar-worktrees\web-sdk-avatar-three` is a 2,161,287,882-byte active JavaScript/TypeScript SDK worktree. `packages` uses 1,056,453,442 bytes, root `node_modules` uses 619,317,094 bytes, built `dist` uses 1,830,134 bytes, and `src` uses 626,161 bytes. Its feature branch has tracked modifications.
- `convai-avatar-worktrees\character-api-manifest-v1` is a 239,609,191-byte active Python/API worktree. Its local environment uses 189,147,306 bytes, the mypy cache uses 33,657,061 bytes, and application source uses 3,954,409 bytes. Its feature branch has tracked modifications.
- `convai-avatar-worktrees\gcp-app-infra-dev21` is a 5,267,697-byte infrastructure worktree; `apps` accounts for 4,721,233 bytes. It is on the `devslot/dev21-playground-secret-access` branch.
- The two standalone character-API environments are 242,013,409 and 242,160,055 bytes, almost entirely installed Python packages and launch scripts.
- `convai-playground-pnpm-store` is a 1,028,533,476-byte dependency store: 1,028,525,284 bytes are in its v10 store and 8,192 bytes in v11.
- `convai-playground-portrait-qa` contains 49 source/comparison/final images. The eight-image `originals` directory is 5,791,969 bytes, with the remaining roughly 5.2 MB in candidate, before/after, browser, and final portrait evidence.

## Retained active and trusted paths

- `E:\temp\AI Video Tutorial Generator\build\cargo-current`
- `E:\temp\AI Video Tutorial Generator\build\pipeline-current`
- `E:\temp\AI Video Tutorial Generator\build\sidecar`
- `E:\temp\AI Video Tutorial Generator Test Sandbox`, including `Runtime\node`, all `Models`, presenter runtime manifests, and the silence-fix backups
- `E:\temp\Alystria Studio 2.0 Test Sandbox Final\Runtime`
- `E:\temp\avt-audit-2026-09-05`
- `E:\temp\avt-presenter-bench-2026-09-05`
- `E:\temp\avt-catalog-brand-audit-2026-09-05`
- `E:\temp\avt-catalog-visual-2026-09-05`
- `E:\temp\alystria-editor-export-smoke`
- `E:\temp\alystria-editor-keyframe-smoke`
- `E:\temp\alystria-aligner-runtime`
- `E:\temp\Alystria Local Image Lab`, including ComfyUI, its environment and caches, in-progress checkpoint parts, LoRAs, and evidence

Older evidence, source assets, presenter inputs, test sandboxes, and runtime sources outside the verified list were retained because they were not confirmed obsolete. No unrelated or shared `E:` directory was inventoried recursively or selected for removal.

## Remaining Alystria / presenter roots after manual deletion

The following snapshot was taken after the quarantine disappeared. It explains why many Alystria-named folders remain even though the large rejected runtimes and caches are gone.

| Folder | Bytes | Current decision |
| --- | ---: | --- |
| `E:\temp\AI Video Tutorial Generator` | 9,220,724,206 | Keep: current build, pipeline, audits, benchmark and packaging evidence. |
| `E:\temp\AI Video Tutorial Generator Test Sandbox` | 16,786,970,888 | Keep: current portable app, runtime, models, projects and native test target. |
| `E:\temp\Alystria Local Image Lab` | 14,964,304,772 | Keep: active ComfyUI environment, selected models/LoRA, caches and current evidence. |
| `E:\temp\Alystria Studio` | 5,909,712,222 | Hold through final proof: older canonical evidence and runtime sources; no active process, but removal has not been signed off while final integration work is active. |
| `E:\temp\Alystria Studio 2.0 Test Sandbox Final` | 806,454,590 | Keep: trusted runtime packaging source; its Node executable is in active use. |
| `E:\temp\alystria-aligner-runtime` | 591,430,903 | Keep: current forced-alignment runtime and smoke evidence. |
| `E:\temp\avt-presenter-bench-2026-09-05` | 280,089,942 | Keep: current presenter quality proof. |
| `E:\temp\alystria-editor-export-smoke` | 226,524 | Keep through final proof: current editor export evidence. |
| `E:\temp\alystria-editor-keyframe-smoke` | 20,455 | Keep through final proof: current keyframe evidence. |
| `E:\temp\Alystria Presenter Inputs` | 249,472 | Keep through final presenter proof. |
| `E:\temp\Alystria Source Assets` | 61,339,476 | Keep through final presenter/visual proof. |

Eight older visual, GPU-smoke, packaged-sandbox, and rejected presenter-benchmark folders totaling 1,006,133,236 bytes were moved into `E:\uesless\Alystria Cleanup Review 2026-09-05`: `AI Video Tutorial Generator Visual Acceptance`, both old GPU-smoke input folders and the old GPU-smoke result, `Alystria Studio Test Area`, `Alystria Test Sandbox`, `Alystria Visual Acceptance`, and `avt-presenter-bench-2026-09-04`. Its `MOVE-MANIFEST.md` records their original paths, byte counts, completed move verification, and relocation from the temporary review path. The presenter lane released the September 4 benchmark after confirming that the September 5 proof and selected runtime remain protected.

Nineteen untracked repository scratch helpers totaling 45,969 bytes were also moved to `E:\uesless\AI Video Tutorial Generator Repo Scratch 2026-09-05`. Its manifest records every original file. The active `.ui-routes.mjs` QA helper was preserved in the repository. `E:\temp\Alystria Rejected Assets Review` was absent at the current check, consistent with it having already been removed; it was not recreated.

The rejected generated presenter candidate `teacher-mateo-v1.png` was moved from the repository to `E:\uesless\AI Video Tutorial Generator Rejected Assets\teacher-mateo-v1.png`. It was untracked and had no app/code reference. The destination was verified at 2,006,961 bytes with SHA-256 `7e16b3b7b82d4a5871c858edfbab25681d850b44d6ba369f03af3ccb2758755c`; the adjacent manifest preserves its original path.

## Live state after owner cleanup

The three `E:\uesless` Alystria / AI Video Tutorial Generator paths described immediately above were temporary staging locations. All three were absent at the next check, consistent with the user continuing the manual cleanup; this agent did not delete them. At the latest check, `E:\uesless` contained only `CupcakeAI-security-acceptance-20260905` and `InteractiveNPCs`. Those are other projects and were not inspected recursively, moved, or changed. `E:` had 328,898,707,456 bytes (306.31 GiB) free.

The remaining `E:\temp\Alystria Studio` tree is 5,909,712,222 bytes and has no referencing process. It is held until the current Windows-native proof releases historical dependencies:

| Child | Bytes | Post-proof disposition |
| --- | ---: | --- |
| `evidence` | 2,883,092,302 | Candidate: September 1–3 superseded renders, identity checks, rejected diagnostics, and old logs. |
| `runtime-sources` | 1,527,698,919 | Candidate after Windows release: one Chromium source, Node 24 source, four full FFmpeg candidates, and two empty FFmpeg candidate folders. |
| Three `canonical-visual-specimen-*` folders | 1,483,702,896 | Candidate: superseded canonical rendered specimens. |
| Four `canonical-evaluation-*` folders | 15,161,375 | Candidate: superseded evaluation outputs associated with those specimens. |
| Root smoke/build helper files | 56,730 | Candidate with the historical tree. |
| `models` | 0 | Empty candidate. |

No current process references `E:\temp\Alystria Studio`. Repository references are limited to a legacy resume helper, documentation, and synthetic Windows-path tests. The current Test Sandbox contains five text activation or shebang references to the old virtual-environment location (`activate`, `activate.bat`, `jp.py`, `numba`, and `pygrun`), plus 69 distlib console-launcher executables and three `Scripts` bytecode files with embedded historical interpreter or source strings. This corrects the earlier one-file summary. None is on the pinned presenter path: the current profile directly launches the Test Sandbox `venv\Scripts\python.exe`, and that interpreter, the current worker and adapters, presenter profile, source manifest, and forced-aligner configuration contain no old-root string. Current presenter/runtime assets remain in the separate Test Sandbox and trusted Studio 2.0 Final runtime. The whole 5.91 GB historical Studio tree should move to `E:\uesless` only after the Windows owner confirms final native proof no longer needs rollback sources.

The current aligner must remain installed. Its `model\part-0.bin` through `model\part-3.bin` files total about 155.36 MB and are not referenced by `alignment-runtime.json`; they are a separate post-proof cleanup candidate after alignment evidence is recorded.

After the Windows lane released those four fragments, their exact 155,363,383-byte payload was moved to `E:\uesless\AI Video Tutorial Generator Aligner Download Fragments 2026-09-05`. The adjacent manifest records every source path, byte count, and SHA-256 hash. All source paths are absent and destination hashes match. The active assembled `model_quantized.onnx`, vocabulary, worker, Python runtime, runtime manifest, and smoke evidence remain in `E:\temp\alystria-aligner-runtime`.

## Final safe-now scratch pass

Five empty folders left behind under `E:\temp\AI Video Tutorial Generator` were moved to `E:\uesless\AI Video Tutorial Generator Empty Scratch 2026-09-05`: `build-cache`, `models`, `runtime-temp`, `scratch`, and `venvs`. Each contained zero files and zero bytes, had no active process reference, and was outside current model, runtime, build, and evidence paths. The adjacent manifest records and verifies the move.

At this snapshot, `E:` had 323,855,998,976 bytes (301.61 GiB) free. `E:\uesless` contained that project-owned empty-folder review plus three other-project folders: `CupcakeAI-cleanup-overhaul-20260905-124524-579-18924-30925619`, `CupcakeAI-security-acceptance-20260905`, and `InteractiveNPCs`. The other-project folders were untouched.

No other item is safe to move during the active proof. `.ui-routes.mjs` remains an active QA helper; `PAUSE_HANDOFF_2026-09-05.md` is historical scratch pending final-proof release; `see me` is user-owned; current profile tests, audits, benchmark, showcase, evidence, runtimes, builds, Test Sandbox, Local Image Lab, aligner, and Studio rollback sources remain protected.

## Bounded native-proof refresh

During the current native package/proof run, `E:` had 308,140,498,944 bytes free. The 5.91 GB historical Studio tree remained present with the same top-level contents and disposition above. The four unreferenced aligner download chunks remained present at an exact combined size of 155,363,383 bytes. Neither set was moved because the Windows owner has not released final-proof rollback dependencies.

The only project-owned cleanup folder still present under `E:\uesless` was `AI Video Tutorial Generator Empty Scratch 2026-09-05`, containing five empty source directories plus its manifest. The only other folder there was `interactive-npcs-misty-tracking-scratch-20260905`, which belongs to another project and was left untouched. Repository-root scratch status was unchanged: `.ui-routes.mjs` remained active, the pause handoff remained historical scratch pending release, and `see me` remained user-owned.

## Final repository-helper release

After current native harnesses replaced the route scratch and committed documentation superseded the pause handoff, `.ui-routes.mjs` and `PAUSE_HANDOFF_2026-09-05.md` were released for reversible cleanup. Both ordinary untracked files were moved to `E:\uesless\AI Video Tutorial Generator Final Repo Scratch 2026-09-05`. Their adjacent manifest records exact source paths, destinations, byte counts, SHA-256 hashes, and reasons. The combined moved payload is 19,530 bytes; both repository sources are absent and both destination hashes were verified. `see me` remains untouched as user-owned material.

Only the 5.91 GB historical Alystria Studio tree remains pending final native-proof release. The aligner chunks were subsequently released and moved as recorded above.

## Package and proof-history candidates during final rebuild

This is a read-only inventory. Nothing in this section was moved because the Windows lane is rebuilding and validating the native package. At the snapshot, `E:` had 323,890,835,456 bytes free.

| Exact path | Bytes | Later-cleanup rationale |
| --- | ---: | --- |
| `E:\temp\AI Video Tutorial Generator\build\cargo-current` | 10,667,826,966 | Re-creatable Rust build cache after the final executable and proof are accepted. |
| `E:\temp\AI Video Tutorial Generator\build\sidecar` | 299,995,308 | Seven PyInstaller work roots; active PowerShell build processes currently reference this area. Move only after the rebuild exits. |
| `E:\temp\AI Video Tutorial Generator\build\pipeline-31f72f3-20260905` | 39,216,458 | Superseded versioned pipeline build. |
| `E:\temp\AI Video Tutorial Generator\build\pipeline-617b433-20260905-132016657` | 39,230,876 | Superseded versioned pipeline build. |
| `E:\temp\AI Video Tutorial Generator\build\pipeline-9e18851-20260905-131856774` | 39,232,149 | Superseded versioned pipeline build. |
| `E:\temp\AI Video Tutorial Generator\build\pipeline-bdd4115-20260905-130318463` | 39,232,670 | Superseded versioned pipeline build. |
| `E:\temp\AI Video Tutorial Generator\build\pipeline-f81bb2b-20260905-133414935` | 39,235,020 | Its executable hash matches the currently packaged runtime copy, so the build-directory copy can move only after final proof. |
| `E:\temp\AI Video Tutorial Generator\build\pipeline-current` | 39,213,110 | Current builder output; becomes a candidate only after the final package is accepted. |
| `E:\temp\AI Video Tutorial Generator Test Sandbox\Temp` | 2,349,500,235 | Seventy PyInstaller `_MEI*` extraction trees. Move the parent only after every native process exits. |
| `E:\temp\AI Video Tutorial Generator Test Sandbox\Evidence\native-clean-first-launch.previous-*` | 164,239,681 | Fourteen prior proof snapshots. Preserve the current `native-clean-first-launch` tree and all other evidence/media/reports. |

The 14 exact prior-proof directories are:

| Directory suffix after `Evidence\` | Bytes |
| --- | ---: |
| `native-clean-first-launch.previous-20260905103212761-34284-1` | 301,886 |
| `native-clean-first-launch.previous-20260905103337680-11516-1` | 301,886 |
| `native-clean-first-launch.previous-20260905103509533-46632-1` | 301,886 |
| `native-clean-first-launch.previous-20260905103654336-41096-1` | 573,564 |
| `native-clean-first-launch.previous-20260905110200229-5216-1` | 1,010,947 |
| `native-clean-first-launch.previous-20260905112840387-45800-1` | 1,012,344 |
| `native-clean-first-launch.previous-20260905131500031-24016-1` | 1,153,086 |
| `native-clean-first-launch.previous-20260905132436950-11244-1` | 115 |
| `native-clean-first-launch.previous-20260905133854384-33612-1` | 30,139,651 |
| `native-clean-first-launch.previous-20260905134256293-23960-1` | 30,168,553 |
| `native-clean-first-launch.previous-20260905134806810-47148-1` | 10,067,007 |
| `native-clean-first-launch.previous-20260905135018020-26004-1` | 29,013,119 |
| `native-clean-first-launch.previous-20260905135850728-32156-1` | 30,097,152 |
| `native-clean-first-launch.previous-20260905141254657-37468-1` | 30,098,485 |

The listed non-empty candidates total 13,716,922,473 bytes (12.77 GiB) when the still-current `pipeline-current` copy is included. Also present as zero-byte future candidates are `build\sidecar-current`, Test Sandbox `Models\download-quarantine`, and Test Sandbox `Runtime\work`. Test Sandbox `Models` (15.94 GB), `Runtime` (754 MB), current `Evidence` (11.28 MB), remaining evidence/media/reports, `App`, `App Data`, and `Projects` remain protected.

## Reversible historical-Studio absence test — 2026-09-07

The dependency audit supported a controlled absence test before starting the final native Elena run. At `2026-09-07T06:12:26.4530540Z`, the exact ordinary directory `E:\temp\Alystria Studio` was moved with native `.NET Directory.Move` on the same `E:` volume to `E:\uesless\AI Video Tutorial Generator Historical Alystria Studio 2026-09-07`. This was a reversible rename, not a deletion.

Immediately before the move, `E:\`, `E:\temp`, `E:\uesless`, and the source were verified as ordinary non-reparse directories; the destination did not exist; the complete source contained zero reparse-point descendants; and no other running process executable, command line, or loaded module referenced the source. The inventory matched the previous audit exactly. Immediately after the move, the original was absent and the destination retained the same 5,909,712,222 bytes, 6,823 files, 1,384 descendant directories, and zero reparse points. The separate manifest is `E:\uesless\AI Video Tutorial Generator Historical Alystria Studio 2026-09-07 MOVE-MANIFEST.md`, SHA-256 `c83c3642bdf312f82afcd395a6bb180ff5b233eb1cc5eb71a2c93e28965f93e6` at the verification snapshot.

The native run began only after the old root was absent. Its result is pending. If it exposes a historical dependency, the rollback is the exact reverse same-volume move after stopping only the task-owned app, worker, presenter Python, and FFmpeg children and revalidating both paths. If it passes, the quarantined tree can remain in `E:\uesless` for owner deletion.

## Read-only post-proof candidate refresh — 2026-09-07

No candidate in this section was moved because the final native app and pipeline worker were active. The stable build candidates below contained 11,403,990,776 bytes and zero reparse points at the snapshot:

| Exact path | Bytes | Files | Condition |
| --- | ---: | ---: | --- |
| `E:\temp\AI Video Tutorial Generator\build\cargo-current` | 10,667,826,966 | 6,148 | Re-creatable only after the final package and native proof are accepted. |
| `E:\temp\AI Video Tutorial Generator\build\sidecar` | 299,995,308 | 112 | Seven older PyInstaller work roots; preserve until final acceptance. |
| `E:\temp\AI Video Tutorial Generator\build\desktop-source-0345387-current` | 56,927,744 | 1 | Packaged desktop staging source; preserve until final acceptance. |
| `E:\temp\AI Video Tutorial Generator\build\sidecar-work-d539109` | 42,931,913 | 16 | First final-sidecar build work root. |
| `E:\temp\AI Video Tutorial Generator\build\sidecar-work-d539109-retry1` | 42,931,980 | 16 | Successful final-sidecar retry work root. |
| `E:\temp\AI Video Tutorial Generator\build\sidecar-output-d539109` | 18,767,799 | 1 | First final-sidecar output. |
| `E:\temp\AI Video Tutorial Generator\build\sidecar-output-d539109-retry1` | 39,248,783 | 51 | Successful final-sidecar retry output; preserve until the packaged worker is accepted. |
| Five superseded `pipeline-*` versioned roots | 196,147,173 | 255 | Superseded copies, but retain through final acceptance. |
| `E:\temp\AI Video Tutorial Generator\build\pipeline-current` | 39,213,110 | 51 | Current builder output; retain through final acceptance. |

The Test Sandbox `Temp` tree is dynamic while the packaged PyInstaller worker runs. It measured 2,418,602,879 bytes before the worker child appeared and 2,453,154,201 bytes after a new 34,551,322-byte extraction tree appeared. The later snapshot contained no reparse points. Move it only after the app, both PyInstaller worker processes, presenter processes, and FFmpeg children exit.

The fourteen prior `native-clean-first-launch.previous-*` evidence trees still contain 164,239,681 ordinary-file bytes. Six of those trees each contain one `Content.IE5` junction targeting the current Test Sandbox `App Data\User Profile\AppData\Local\Microsoft\Windows\INetCache\IE`. Do not recursively delete or treat those junction targets as evidence content. Any later removal must unlink each junction without recursion first, preserve the current `native-clean-first-launch` proof, and then act only on the fourteen exact historical roots.

At this snapshot, `Models\download-quarantine` remained an ordinary empty directory. `Runtime\work` contained one empty descendant directory and zero files. The stable build candidates, dynamic Test Sandbox `Temp` snapshot, and prior evidence account for 14,021,384,658 bytes (13.06 GiB), excluding small build logs and status files. They remain read-only candidates until the final native acceptance completes.

## Obsolete Rust cache released — 2026-09-08

At 09:32:29 UTC, `E:\temp\AI Video Tutorial Generator\build\cargo-current`
was moved by same-volume .NET directory rename to
`E:\uesless\AI Video Tutorial Generator Obsolete Rust Cache 2026-09-08`.
Current successful desktop builds use the separate
`build\acceptance-7c79d5d\desktop-target` root, so this reproducible old cache
is no longer a rollback dependency. No process executable or command line
referenced it. All ancestors and descendants were checked without traversing
reparse points; none were present. Before and after inventories agree exactly:
10,667,826,966 bytes, 6,148 files, and 664 descendant directories. The original
source is absent. The adjacent `MOVE-MANIFEST.json` records both paths and
verification. This was a reversible move for owner deletion, not reclaimed
space. The active app, current build, models, projects, and media evidence were
not moved.
