import { test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { MultiPropertyKBReader, createMultiPropertyKBReader } from "./multi-reader";
import { KnowledgeBaseReader } from "./reader";

const testDir = join(import.meta.dir, "test-multi-tmp");
const commonKBPath = join(testDir, "common.md");
const propertyKBPath = join(testDir, "properties", "test-prop.md");
const propertyDir = join(testDir, "properties");
const mapPath = join(testDir, "property-map.json");

const commonContent = `# Common Knowledge Base

## WiFi
Common WiFi network is SharedNet with password CommonPass.

## Check-in Instructions
Check-in time is 3:00 PM for all properties.
`;

const propertyContent = `# Property-Specific Knowledge Base

## Property WiFi
Property WiFi network is PropNet with password PropPass123.

## Special Rules
This property has special quiet hours after 9 PM.
`;

const propertyMap = {
  properties: [
    {
      code: "TEST-PROP",
      names: ["TestProp", "Test Property"],
      address: "123 Test Street",
      kbFile: "properties/test-prop.md",
    },
    {
      code: "MISSING-PROP",
      names: ["MissingProp"],
      address: "456 Missing Lane",
      kbFile: "properties/missing-file.md",
    },
  ],
};

beforeAll(() => {
  mkdirSync(propertyDir, { recursive: true });
  writeFileSync(commonKBPath, commonContent);
  writeFileSync(propertyKBPath, propertyContent);
  writeFileSync(mapPath, JSON.stringify(propertyMap, null, 2));
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

test("search with known property returns property-specific + common results", () => {
  const reader = new MultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const result = reader.search("wifi", "TestProp");
  expect(result).toContain("Property WiFi");
  expect(result).toContain("PropNet");
  expect(result).toContain("Common WiFi");
  expect(result).toContain("SharedNet");
});

test("property-specific content appears before common content", () => {
  const reader = new MultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const result = reader.search("wifi", "TestProp");
  expect(result.indexOf("Property WiFi")).toBeLessThan(result.indexOf("Common WiFi"));
});

test("search without property name returns common-only results", () => {
  const reader = new MultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const result = reader.search("wifi");
  expect(result).toContain("Common WiFi");
  expect(result).not.toContain("Property WiFi");
  expect(result).not.toContain("PropNet");
});

test("search with unknown property name falls back to common-only", () => {
  const reader = new MultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const result = reader.search("wifi", "UnknownProp");
  expect(result).toContain("Common WiFi");
  expect(result).not.toContain("Property WiFi");
});

test("missing common KB returns graceful fallback", () => {
  const reader = new MultiPropertyKBReader(
    join(testDir, "nonexistent-common.md"),
    propertyDir,
    mapPath
  );
  const result = reader.search("wifi");
  expect(result).toContain("No matching sections found");
});

test("missing property KB file falls back to common-only", () => {
  const reader = new MultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const result = reader.search("wifi", "MissingProp");
  expect(result).toContain("Common WiFi");
  expect(result).not.toContain("Property WiFi");
});

test("search(query) without propertyName matches common KB directly", () => {
  const reader = new MultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const commonReader = new KnowledgeBaseReader(commonKBPath);
  expect(reader.search("wifi")).toBe(commonReader.search("wifi"));
});

test("createMultiPropertyKBReader factory returns working instance", () => {
  const reader = createMultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const result = reader.search("check-in");
  expect(result).toContain("Check-in");
  expect(result).toContain("3:00 PM");
});

test("partial property name match resolves correctly", () => {
  const reader = new MultiPropertyKBReader(commonKBPath, propertyDir, mapPath);
  const result = reader.search("wifi", "Test Property");
  expect(result).toContain("Property WiFi");
  expect(result).toContain("Common WiFi");
});
