import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

test("Levis 0.9.8 tells its user once that it is now Textus, and where to get it", async ({
  page,
}) => {
  await openApp(page, {
    settings: { language: "en", textusNoticeShown: false },
  });
  const dialog = page.locator(".app-dialog");
  await expect(dialog).toContainText("Levis is now Textus");
  await expect(dialog).toContainText("This is the last version of Levis.");
  await dialog.getByRole("button", { name: "Get Textus" }).click();
  await expect(dialog).toHaveCount(0);
  // Seen: remembered, so it isn't shown again.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("catvinci-settings") ?? "{}")
            .textusNoticeShown,
      ),
    )
    .toBe(true);
});
