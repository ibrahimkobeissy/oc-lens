import { expectTypeOf } from "vitest";

import type { OcRouteData } from "./use-oc";
import type { SessionDetail, SessionFilesData } from "@/types/oc";

// OCL-103 typed route precedence: the /files suffix maps before the generic session-detail
// route. Type-checked by `tsc` (pnpm typecheck) — not a vitest runtime test, hence `.test-d.ts`
// rather than `.test.ts` (code-review-2026-08-02.md L1: the old `use-oc-files.test.ts` name
// implied a sibling `use-oc-files.ts` implementation module that has never existed).
expectTypeOf<OcRouteData<"/api/sessions/ses_1/files">>().toEqualTypeOf<SessionFilesData>();
expectTypeOf<OcRouteData<"/api/sessions/ses_1/files?source=replay">>().toEqualTypeOf<SessionFilesData>();
expectTypeOf<OcRouteData<"/api/sessions/ses_1">>().toEqualTypeOf<SessionDetail>();
