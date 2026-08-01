import { describe, expect, it } from "vitest";
import { categorizeToolError } from "../errors";

describe("categorizeToolError", () => {
  it("categorises a missing-file message", () => {
    expect(categorizeToolError("ENOENT: no such file or directory, open '/tmp/missing.py'")).toBe("file-not-found");
    expect(categorizeToolError("File /tmp/missing.py does not exist")).toBe("file-not-found");
  });

  it("categorises a missing-search-string message", () => {
    expect(categorizeToolError("String not found in file")).toBe("string-not-found");
    expect(categorizeToolError("No matches found for pattern")).toBe("string-not-found");
  });

  it("categorises a permission-denied message", () => {
    expect(categorizeToolError("EACCES: permission denied, open '/etc/shadow'")).toBe("permission-denied");
  });

  it("categorises a timeout message", () => {
    expect(categorizeToolError("Command timed out after 30000ms")).toBe("timeout");
    expect(categorizeToolError("ETIMEDOUT")).toBe("timeout");
  });

  it("categorises a syntax-error message", () => {
    expect(categorizeToolError("SyntaxError: Unexpected token '}'")).toBe("syntax");
  });

  it("falls back to 'other' for an unrecognised error shape", () => {
    expect(categorizeToolError("Something inexplicable happened")).toBe("other");
  });
});
