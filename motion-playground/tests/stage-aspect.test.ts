import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { exportStageForDoc } from "../scripts/export-stage.mjs";
import { Canvas } from "../src/components/Canvas";
import { EFFECTS } from "../src/effects/registry";
import { focusCamGeom } from "../src/effects/hud/camGeom";
import { parseOverlayAutosave } from "../src/overlay/autosave";
import { parseOverlay } from "../src/overlay/types";
import { DEFAULT_ASPECT, snapGuidesForAspect, stageForAspect } from "../src/stage";

describe("overlay aspect contract", () => {
  it("keeps legacy projects on the 16:9 stage", () => {
    const { doc, error } = parseOverlay({ version: 1, cards: [] });

    assert.equal(error, undefined);
    assert.equal(doc?.aspect, undefined);
    assert.equal(DEFAULT_ASPECT, "16:9");
    assert.deepEqual(stageForAspect(doc?.aspect), { w: 1920, h: 1080 });
    assert.deepEqual(stageForAspect(null), { w: 1920, h: 1080 });
    assert.deepEqual(stageForAspect("invalid" as never), { w: 1920, h: 1080 });
  });

  it("round-trips a 9:16 project and resolves its stage", () => {
    const { doc, error } = parseOverlay({ version: 1, aspect: "9:16", cards: [] });

    assert.equal(error, undefined);
    assert.equal(doc?.aspect, "9:16");
    assert.deepEqual(stageForAspect(doc?.aspect), { w: 1080, h: 1920 });
  });

  it("rejects an aspect outside the export whitelist", () => {
    const { doc, error } = parseOverlay({ version: 1, aspect: "4000:1", cards: [] });

    assert.equal(doc, undefined);
    assert.match(error ?? "", /画幅/);
  });

  it("does not restore an autosave whose overlay aspect is invalid", () => {
    const restored = parseOverlayAutosave(
      JSON.stringify({
        overlay: {
          version: 1,
          aspect: "4000:1",
          cards: [{ id: "card-1", kind: "blur-text", start: 0, end: 1, params: {} }],
        },
        videoUrl: "/_media/talking-head.mp4",
      }),
    );

    assert.equal(restored.doc, undefined);
    assert.match(restored.error ?? "", /画幅/);
  });

  it("restores a valid portrait autosave with its local media metadata", () => {
    const restored = parseOverlayAutosave(
      JSON.stringify({
        overlay: {
          version: 1,
          aspect: "9:16",
          cards: [{ id: "card-1", kind: "blur-text", start: 0, end: 1, params: {} }],
        },
        srt: [{ start: 0, end: 1, text: "Portrait caption" }],
        videoUrl: "/_media/talking-head.mp4",
      }),
    );

    assert.equal(restored.error, undefined);
    assert.equal(restored.doc?.aspect, "9:16");
    assert.equal(restored.doc?.cards[0]?.kind, "blur-text");
    assert.deepEqual(restored.srt, [{ start: 0, end: 1, text: "Portrait caption" }]);
    assert.equal(restored.videoUrl, "/_media/talking-head.mp4");
  });

  it("keeps the browser renderer viewport aligned with the editor stage", () => {
    assert.deepEqual(exportStageForDoc({ aspect: "16:9" }), stageForAspect("16:9"));
    assert.deepEqual(exportStageForDoc({ aspect: "9:16" }), stageForAspect("9:16"));
    assert.deepEqual(exportStageForDoc({ aspect: "4000:1" }), stageForAspect());
  });

  it("keeps the portrait focus camera inside the stage", () => {
    const stage = stageForAspect("9:16");
    const frame = focusCamGeom({}, "9:16");

    assert.ok(frame.x >= 0 && frame.y >= 0);
    assert.ok(frame.x + frame.w <= stage.w);
    assert.ok(frame.y + frame.h <= stage.h);
    assert.equal(frame.x, Math.round((stage.w - frame.w) / 2));
  });

  it("uses each aspect's visible safe edges as the drag snap origins", () => {
    assert.deepEqual(snapGuidesForAspect("16:9"), { x: 120, y: 96 });
    assert.deepEqual(snapGuidesForAspect("9:16"), { x: 72, y: 120 });
    assert.deepEqual(snapGuidesForAspect("invalid" as never), { x: 120, y: 96 });
  });
});

describe("portrait canvas", () => {
  it("renders the portrait dimensions and shared CSS stage variables", () => {
    const effect = EFFECTS.find((candidate) => candidate.id === "focus-card");
    assert.ok(effect);

    const markup = renderToStaticMarkup(
      createElement(Canvas, {
        effect,
        params: effect.defaults,
        playToken: 1,
        showGuides: true,
        showPerson: true,
        videoUrl: null,
        fxScale: 1,
        aspect: "9:16",
      }),
    );

    assert.match(markup, /data-aspect="9:16"/);
    assert.match(markup, /width:1080px/);
    assert.match(markup, /height:1920px/);
    assert.match(markup, /--stage-w:1080px/);
    assert.match(markup, /--stage-h:1920px/);
  });

  it("injects portrait geometry into the focus-card library preview", () => {
    const effect = EFFECTS.find((candidate) => candidate.id === "focus-card");
    assert.ok(effect);
    const frame = focusCamGeom(effect.defaults, "9:16");

    const markup = renderToStaticMarkup(
      createElement(Canvas, {
        effect,
        params: effect.defaults,
        playToken: 1,
        showGuides: false,
        showPerson: false,
        videoUrl: null,
        fxScale: 1,
        aspect: "9:16",
      }),
    );

    assert.match(markup, new RegExp(`--fcd-x:${frame.x}px`));
    assert.match(markup, new RegExp(`--fcd-w:${frame.w}px`));
  });
});
