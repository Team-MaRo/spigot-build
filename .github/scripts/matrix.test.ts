// Unit tests for the pure logic in matrix.ts. Run with:
//   npx -y tsx --test .github/scripts/matrix.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { jdkFor, sortVersions, selectVersions, UNBUILDABLE, NEEDS_SNAPSHOT_REPO, isVersionName } from "./matrix.ts";

test("jdkFor maps each boundary band (from jdk-boundaries.json)", () => {
  assert.equal(jdkFor("1.8.8"), "8");
  assert.equal(jdkFor("1.16.5"), "8");
  assert.equal(jdkFor("1.17"), "16");
  assert.equal(jdkFor("1.17.1"), "16");
  assert.equal(jdkFor("1.18"), "17");
  assert.equal(jdkFor("1.20.4"), "17");
  assert.equal(jdkFor("1.20.5"), "21");
  assert.equal(jdkFor("1.21.11"), "21");
  assert.equal(jdkFor("26.1"), "25");
  assert.equal(jdkFor("26.1.2"), "25");
});

test("sortVersions: numeric, shorter-prefix-first, year-based last", () => {
  assert.deepEqual(
    sortVersions(["1.20.10", "1.20.2", "1.20", "26.1", "1.9", "1.9"]),
    ["1.9", "1.20", "1.20.2", "1.20.10", "26.1"],
  );
});

test("selectVersions latest = newest only", () => {
  assert.deepEqual(selectVersions("latest", ["1.20", "1.21", "26.1"], [], 3), ["26.1"]);
});

test("selectVersions all = every buildable", () => {
  assert.deepEqual(selectVersions("all", ["1.20", "1.21"], [], 3), ["1.20", "1.21"]);
});

test("selectVersions all-released = released ∩ buildable", () => {
  assert.deepEqual(
    selectVersions("all-released", ["1.20", "1.21"], ["1.20", "1.21", "9.9"], 3),
    ["1.20", "1.21"], // 9.9 has a release but isn't buildable -> excluded
  );
});

test("selectVersions missing (newest-n>0) = unreleased ∪ newest N", () => {
  assert.deepEqual(
    selectVersions("missing", ["1.19", "1.20", "1.21"], ["1.19", "1.20"], 3),
    ["1.19", "1.20", "1.21"], // 1.21 missing + newest-3 re-adds 1.19/1.20
  );
});

test("selectVersions missing with newest-n 0 = only unreleased (no whole-list bug)", () => {
  assert.deepEqual(
    selectVersions("missing", ["1.19", "1.20", "1.21"], ["1.19", "1.20"], 0),
    ["1.21"], // slice(-0) must NOT re-add everything
  );
});

test("selectVersions specific = just that version", () => {
  assert.deepEqual(selectVersions("1.20.4", ["1.20.4", "1.21"], [], 3), ["1.20.4"]);
});

test("UNBUILDABLE skips the aliased revs (BuildTools builds a different version)", () => {
  for (const v of [
    "1.8.4", "1.8.5", "1.8.6", "1.8.7", "1.10", "1.11.1",
    "1.20", "1.20.3", "1.20.5", "1.21", "1.21.2", "1.21.7", "1.21.9", "26.1", "26.1.1",
  ]) {
    assert.ok(UNBUILDABLE.has(v), `${v} should be unbuildable (aliased)`);
  }
  // Alias TARGETS and ordinary versions remain buildable (incl. 1.17, which just
  // needs JDK 16, and 1.21.11 which BuildData mislabels but builds as itself):
  for (const v of ["1.8.8", "1.10.2", "1.11.2", "1.20.1", "1.20.4", "1.20.6", "1.21.1", "1.21.3", "1.21.8", "1.21.10", "26.1.2", "1.17", "1.21.11"]) {
    assert.ok(!UNBUILDABLE.has(v), `${v} should be buildable`);
  }
});

test("isVersionName: accepts releases + pre/rc, rejects build-number revs", () => {
  for (const v of ["1.8", "1.16.5", "1.21.11", "26.2", "1.13-pre7", "1.18-pre5", "1.18-rc3", "1.14.3-pre4"]) {
    assert.ok(isVersionName(v), `${v} should be a version name`);
  }
  for (const v of ["1021", "1251-a", "582-b", "4195-a", "1.19-beta", "spigot"]) {
    assert.ok(!isVersionName(v), `${v} should be rejected`);
  }
});

test("jdkFor handles pre-releases (numeric prefix via parseInt)", () => {
  assert.equal(jdkFor("1.13-pre7"), "8");
  assert.equal(jdkFor("1.14-pre5"), "8");
  assert.equal(jdkFor("1.18-pre5"), "17");
  assert.equal(jdkFor("1.18-rc3"), "17");
});

test("NEEDS_SNAPSHOT_REPO: bungeecord-chat versions build but need the SpigotMC repo seeded", () => {
  for (const v of ["1.8", "1.8.3", "1.9", "1.9.2", "1.11", "1.12"]) {
    assert.ok(NEEDS_SNAPSHOT_REPO.has(v), `${v} should need the snapshot repo`);
    assert.ok(!UNBUILDABLE.has(v), `${v} is buildable (not denylisted)`);
  }
  // A normal version needs neither:
  assert.ok(!NEEDS_SNAPSHOT_REPO.has("1.20.4"));
});
