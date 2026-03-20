import { test, expect, describe } from "bun:test";
import { chunkMarkdown, type Chunk } from "./chunker.js";
import { readFileSync } from "fs";
import { join } from "path";

describe("chunkMarkdown", () => {
  test("empty string returns empty array", () => {
    const result = chunkMarkdown("");
    expect(result).toEqual([]);
  });

  test("whitespace-only string returns empty array", () => {
    const result = chunkMarkdown("   \n\n  ");
    expect(result).toEqual([]);
  });

  test("normal markdown with ## sections", () => {
    const markdown = `## WiFi
Network: TestNet
Password: abc123
This is a longer description to ensure the chunk is long enough

## House Rules
- No smoking
- No pets
- No loud noise after 10pm
This is additional content to meet minimum length`;

    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(2);
    expect(result[0]?.heading).toBe("WiFi");
    expect(result[0]?.content).toContain("## WiFi");
    expect(result[0]?.content).toContain("Network: TestNet");
    expect(result[1]?.heading).toBe("House Rules");
    expect(result[1]?.content).toContain("## House Rules");
  });

  test("markdown with ### subsections", () => {
    const markdown = `## Main Section
Content here with more details to ensure minimum length is met

### Subsection
Subsection content with additional information to meet minimum length`;

    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(2);
    expect(result[0]?.heading).toBe("Main Section");
    expect(result[1]?.heading).toBe("Subsection");
  });

  test("content before first header becomes chunk with null heading", () => {
    const markdown = `Some preamble content here with more details to ensure minimum length

## First Section
Section content with additional information to meet minimum length`;

    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(2);
    expect(result[0]?.heading).toBeNull();
    expect(result[0]?.content).toContain("Some preamble content");
    expect(result[1]?.heading).toBe("First Section");
  });

  test("markdown with no headers returns single chunk with null heading", () => {
    const markdown = `Just some content
without any headers
multiple lines`;

    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(1);
    expect(result[0]?.heading).toBeNull();
    expect(result[0]?.content).toContain("Just some content");
  });

  test("sections shorter than 50 chars are filtered out", () => {
    const markdown = `## Short
x

## Long Section
This is a much longer section with more content that exceeds the minimum length`;

    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(1);
    expect(result[0]?.heading).toBe("Long Section");
  });

  test("minChunkLength=0 includes all sections", () => {
    const markdown = `## Short
x

## Long
This is longer`;

    const result = chunkMarkdown(markdown, { minChunkLength: 0 });
    expect(result).toHaveLength(2);
  });

  test("H4+ headers are NOT split points", () => {
    const markdown = `## Main Section
Some content

#### Subsub Header
More content`;

    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(1);
    expect(result[0]?.heading).toBe("Main Section");
    expect(result[0]?.content).toContain("#### Subsub Header");
  });

  test("heading field does not include # characters", () => {
    const markdown = `## WiFi
Network info with additional content to ensure minimum length requirement`;

    const result = chunkMarkdown(markdown);
    expect(result[0]?.heading).toBe("WiFi");
    expect(result[0]?.heading).not.toContain("#");
  });

  test("content field includes the heading line", () => {
    const markdown = `## WiFi
Network: TestNet with additional content to ensure minimum length`;

    const result = chunkMarkdown(markdown);
    expect(result[0]?.content).toContain("## WiFi");
  });

  test("consecutive headers with empty body", () => {
    const markdown = `## First

## Second
Content here with additional information to ensure minimum length`;

    const result = chunkMarkdown(markdown);
    // First header has no content, should be filtered
    expect(result).toHaveLength(1);
    expect(result[0]?.heading).toBe("Second");
  });

  test("whitespace is trimmed from heading and content", () => {
    const markdown = `##   WiFi   
  Network info with additional content to ensure minimum length  `;

    const result = chunkMarkdown(markdown);
    expect(result[0]?.heading).toBe("WiFi");
    expect(result[0]?.content).not.toMatch(/^\s/);
    expect(result[0]?.content).not.toMatch(/\s$/);
  });

  test("chunking knowledge-base/common.md produces >5 chunks", () => {
    const kbPath = join(
      import.meta.dir,
      "../../knowledge-base/common.md"
    );
    const markdown = readFileSync(kbPath, "utf-8");
    const result = chunkMarkdown(markdown);

    expect(result.length).toBeGreaterThan(5);
    // Verify structure
    expect(result[0]).toHaveProperty("heading");
    expect(result[0]).toHaveProperty("content");
  });

  test("mixed H2 and H3 headers are both split points", () => {
    const markdown = `## Level 2
Content with additional details to ensure minimum length requirement

### Level 3
More content with additional information to ensure minimum length

## Another Level 2
Final content with additional details to ensure minimum length`;

    const result = chunkMarkdown(markdown);
    expect(result).toHaveLength(3);
    expect(result[0]?.heading).toBe("Level 2");
    expect(result[1]?.heading).toBe("Level 3");
    expect(result[2]?.heading).toBe("Another Level 2");
  });

  test("preserves multi-line content within sections", () => {
    const markdown = `## Section
Line 1 with additional content
Line 2 with more details
Line 3 with even more information to ensure minimum length`;

    const result = chunkMarkdown(markdown);
    expect(result[0]?.content).toContain("Line 1");
    expect(result[0]?.content).toContain("Line 2");
    expect(result[0]?.content).toContain("Line 3");
  });
});
