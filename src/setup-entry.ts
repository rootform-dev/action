import * as core from "@actions/core";
import { setup } from "./setup.ts";

setup().catch((error) => core.setFailed(error instanceof Error ? error.message : String(error)));
