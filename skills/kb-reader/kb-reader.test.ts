import { test, expect, beforeAll, afterAll } from "bun:test";
import { KnowledgeBaseReader, createKBReader } from "./reader";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const testKBPath = join(import.meta.dir, "test-kb.md");

const testKBContent = `# Test Knowledge Base

## WiFi / Access

The WiFi network is TestNet and the password is TestPass123.
You can connect to the network using your device settings.

## Check-in Instructions

Check-in time is 3:00 PM. Please use the door code provided in your email.
The code will be active starting at your check-in time.

## Parking

We have 2 parking spots available in the driveway.
Street parking is not permitted after 10 PM.

## Maintenance

If you experience any issues, please contact us immediately.
We have a maintenance team available 24/7 for emergencies.
`;

beforeAll(() => {
  writeFileSync(testKBPath, testKBContent);
});

afterAll(() => {
  unlinkSync(testKBPath);
});

test("search('wifi') returns section containing wifi info", () => {
  const reader = createKBReader(testKBPath);
  const result = reader.search("wifi");
  expect(result).toContain("WiFi");
  expect(result).toContain("TestNet");
  expect(result).toContain("TestPass123");
});

test("search('check-in') returns section containing check-in info", () => {
  const reader = createKBReader(testKBPath);
  const result = reader.search("check-in");
  expect(result).toContain("Check-in");
  expect(result).toContain("3:00 PM");
  expect(result).toContain("door code");
});

test("search('xyz_nonexistent') returns fallback message", () => {
  const reader = createKBReader(testKBPath);
  const result = reader.search("xyz_nonexistent");
  expect(result).toContain("No matching sections found");
});

test("reader handles missing file gracefully", () => {
  const reader = createKBReader("/nonexistent/path/kb.md");
  const result = reader.search("anything");
  expect(result).toContain("No matching sections found");
});

test("search('parking') returns parking section", () => {
  const reader = createKBReader(testKBPath);
  const result = reader.search("parking");
  expect(result).toContain("Parking");
  expect(result).toContain("2 parking spots");
});

test("search is case-insensitive", () => {
  const reader = createKBReader(testKBPath);
  const result1 = reader.search("WIFI");
  const result2 = reader.search("wifi");
  expect(result1).toBe(result2);
});
