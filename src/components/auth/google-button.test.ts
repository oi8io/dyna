import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/components/auth/google-button.tsx"),
  "utf8",
);

/**
 * Following Google's branding guidelines is a requirement for OAuth app
 * verification, not a style preference. These pin the parts that a later
 * redesign would otherwise quietly "fix" into non-compliance.
 */
describe("Sign in with Google button", () => {
  it("uses the four standard brand colours, not the app's palette", () => {
    // "Don't use monochrome versions of the Google G."
    for (const brand of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]) {
      expect(source).toContain(brand);
    }
  });

  it("does not tint the logo with a theme token", () => {
    const logo = source.slice(source.indexOf("function GoogleLogo"));
    expect(logo).not.toContain("currentColor");
    expect(logo).not.toContain("text-accent");
    expect(logo).not.toContain("fill-ink");
  });

  it("uses the light theme's specified fill, stroke and text colours", () => {
    expect(source).toContain('backgroundColor: "#FFFFFF"');
    expect(source).toContain('border: "1px solid #747775"');
    expect(source).toContain('color: "#1F1F1F"');
  });

  it("keeps the specified type size and weight", () => {
    expect(source).toContain("fontSize: 14");
    expect(source).toContain('lineHeight: "20px"');
    expect(source).toContain("fontWeight: 500");
    expect(source).toContain("Roboto");
  });

  it("keeps the web padding spec around the logo and text", () => {
    // 12px before the logo, 10px after it, 12px after the text.
    expect(source).toContain("paddingLeft: 12");
    expect(source).toContain("paddingRight: 12");
    expect(source).toContain("gap-[10px]");
  });

  it("says what the user is doing, rather than just 'Google'", () => {
    // "Don't use the term Google by itself to represent the action."
    expect(source).toContain("使用 Google 账号登录");
  });

  it("keeps the logo's aspect ratio", () => {
    expect(source).toContain('width="18" height="18" viewBox="0 0 48 48"');
  });
});
