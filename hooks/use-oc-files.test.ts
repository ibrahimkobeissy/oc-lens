import { describe, expectTypeOf, it } from "vitest";

import type { OcRouteData } from "./use-oc";
import type { SessionDetail, SessionFilesData } from "@/types/oc";

describe("OCL-103 typed route precedence", () => {
  it("maps the files suffix before the generic session-detail route", () => {
    expectTypeOf<OcRouteData<"/api/sessions/ses_1/files">>().toEqualTypeOf<SessionFilesData>();
    expectTypeOf<OcRouteData<"/api/sessions/ses_1/files?source=replay">>().toEqualTypeOf<SessionFilesData>();
    expectTypeOf<OcRouteData<"/api/sessions/ses_1">>().toEqualTypeOf<SessionDetail>();
  });
});
